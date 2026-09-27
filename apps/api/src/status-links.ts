import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Body,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { ApiError, unavailable } from './api-errors.js';
import type { TokenVerifier, VerifiedAccount } from './auth.js';
import { UUID } from './auth.js';
import type { OperationalLogger } from './logging.js';
import { statusViewerHtml } from './status-viewer.js';
import { RideLimiter } from './ride-limits.js';

export const STATUS_LINKS = Symbol('STATUS_LINKS');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const unavailableLink = () =>
  new ApiError(410, 'STATUS_UNAVAILABLE', 'This status link is unavailable.');
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Invalid status link request.');

export interface StatusLinkMeta {
  linkId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
export interface PublicStatus {
  displayName: string;
  rideState: 'active';
  lastPosition: null | {
    lat: number;
    lon: number;
    accuracyM: number;
    recordedAt: string;
  };
  sosState: 'none' | 'open' | 'reporter_okay' | 'coordination_closed';
  servedAt: string;
  leaseExpiresAt: string;
  linkExpiresAt: string;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
function uuid(value: string): string {
  if (!UUID.test(value)) throw invalid();
  return value.toLowerCase();
}

export class StatusLinkStore {
  private readonly pool: Pool;
  constructor(
    databaseUrl: string,
    private readonly verifier: TokenVerifier,
    private readonly viewerOrigin: string,
    private readonly logger: OperationalLogger,
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      application_name: 'ridr-status',
      max: 4,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 3000,
    });
    this.pool.on('error', () => logger.write('status_pool_error'));
  }
  async close() {
    await this.pool.end();
  }

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ApiError) throw error;
      this.logger.write('status_query_error', {
        code:
          error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown',
      });
      throw unavailable();
    } finally {
      client.release();
    }
  }

  async create(account: VerifiedAccount, rideId: string, key: string, lifetimeHours: number) {
    if (!UUID.test(key) || ![1, 4, 8, 24].includes(lifetimeHours)) throw invalid();
    const operation = `POST /rides/${rideId}/status-links`;
    const digest = sha256(JSON.stringify({ lifetimeHours }));
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${account.id}:${key}`,
      ]);
      const replay = await client.query<{
        operation: string;
        request_hash: Buffer;
        result: StatusLinkMeta;
      }>(
        'SELECT operation, request_hash, result FROM ridr.command_receipts WHERE actor_id=$1 AND command_id=$2',
        [account.id, key],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].operation !== operation || !digest.equals(replay.rows[0].request_hash))
          throw new ApiError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This request key was used for another change.',
          );
        return { ...replay.rows[0].result, url: null, tokenAvailable: false };
      }
      const owner = await client.query<{ id: string }>(
        `SELECT m.id FROM ridr.rides r
         JOIN ridr.memberships m ON m.ride_id=r.id AND m.user_id=$2
         JOIN ridr.profiles p ON p.id=m.user_id
         WHERE r.id=$1 AND r.state='active' AND m.left_at IS NULL AND m.sharing
           AND p.account_state='active' AND p.deleted_at IS NULL
         FOR SHARE OF r, m, p`,
        [rideId, account.id],
      );
      if (!owner.rows[0])
        throw new ApiError(
          403,
          'SHARING_REQUIRED',
          'Start sharing your own location before creating a status link.',
        );
      const token = randomBytes(32).toString('base64url');
      const link = await client.query<{ id: string; created_at: Date; expires_at: Date }>(
        `INSERT INTO ridr.status_links (id, ride_id, owner_member_id, token_hash, lifetime_hours, expires_at)
         VALUES ($1,$2,$3,$4,$5::integer,now()+($5::integer)*interval '1 hour')
         RETURNING id,created_at,expires_at`,
        [randomUUID(), rideId, owner.rows[0].id, sha256(token), lifetimeHours],
      );
      const row = link.rows[0]!;
      const meta: StatusLinkMeta = {
        linkId: row.id,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        revokedAt: null,
      };
      await client.query(
        `INSERT INTO ridr.command_receipts (actor_id, command_id, operation, request_hash, http_status, result, expires_at)
         VALUES ($1,$2,$3,$4,201,$5,now()+interval '24 hours')`,
        [account.id, key, operation, digest, JSON.stringify(meta)],
      );
      await this.verifier.assertActive(account);
      return { ...meta, url: `${this.viewerOrigin}/v1/status#${token}`, tokenAvailable: true };
    });
  }

  async list(account: VerifiedAccount, rideId: string): Promise<StatusLinkMeta[]> {
    const links = await this.pool.query<{
      id: string;
      created_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT sl.id,sl.created_at,sl.expires_at,sl.revoked_at FROM ridr.status_links sl
       JOIN ridr.memberships m ON m.id=sl.owner_member_id
       JOIN ridr.profiles p ON p.id=m.user_id
       WHERE sl.ride_id=$1 AND m.user_id=$2 AND p.account_state='active' AND p.deleted_at IS NULL
       ORDER BY sl.created_at DESC LIMIT 100`,
      [rideId, account.id],
    );
    return links.rows.map((row) => ({
      linkId: row.id,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
    }));
  }

  async revoke(account: VerifiedAccount, rideId: string, linkId: string): Promise<void> {
    await this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE ridr.status_links sl SET revoked_at=coalesce(sl.revoked_at,clock_timestamp())
         FROM ridr.memberships m JOIN ridr.profiles p ON p.id=m.user_id
         WHERE sl.id=$1 AND sl.ride_id=$2 AND sl.owner_member_id=m.id
           AND m.user_id=$3 AND p.account_state='active' AND p.deleted_at IS NULL`,
        [linkId, rideId, account.id],
      );
      if (!result.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Status link not found.');
      await this.verifier.assertActive(account);
    });
  }

  async read(token: string): Promise<PublicStatus> {
    if (!TOKEN.test(token)) throw unavailableLink();
    return this.transaction(async (client) => {
      const link = await client.query<{ ride_id: string }>(
        'SELECT ride_id FROM ridr.status_links WHERE token_hash=$1',
        [sha256(token)],
      );
      if (!link.rows[0]) throw unavailableLink();
      // Lock the ride before the link: stop/end takes this order and cannot race this read.
      const ride = await client.query('SELECT 1 FROM ridr.rides WHERE id=$1 FOR SHARE', [
        link.rows[0].ride_id,
      ]);
      if (!ride.rows[0]) throw unavailableLink();
      const owner = await client.query<{
        member_id: string;
        consent_epoch: string;
        display_name: string;
        expires_at: Date;
      }>(
        `SELECT m.id AS member_id,m.consent_epoch,p.display_name,sl.expires_at
         FROM ridr.status_links sl
         JOIN ridr.rides r ON r.id=sl.ride_id
         JOIN ridr.memberships m ON m.id=sl.owner_member_id AND m.ride_id=r.id
         JOIN ridr.profiles p ON p.id=m.user_id
         WHERE sl.token_hash=$1 AND r.state='active' AND m.left_at IS NULL AND m.sharing
           AND p.account_state='active' AND p.deleted_at IS NULL
           AND sl.revoked_at IS NULL AND sl.expires_at>clock_timestamp()
         FOR SHARE OF sl,m,p`,
        [sha256(token)],
      );
      if (!owner.rows[0]) throw unavailableLink();
      const member = owner.rows[0];
      const position = await client.query<{
        lat: number;
        lon: number;
        accuracy_m: number;
        captured_at: Date;
      }>(
        `SELECT s.lat,s.lon,s.accuracy_m,s.captured_at
         FROM ridr.location_latest ll JOIN ridr.location_samples s ON s.id=ll.sample_id
         WHERE ll.membership_id=$1 AND s.consent_epoch=$2`,
        [member.member_id, member.consent_epoch],
      );
      const sos = await client.query<{ kind: string | null }>(
        `SELECT u.kind FROM ridr.sos_events e
         LEFT JOIN LATERAL (SELECT kind FROM ridr.sos_updates WHERE sos_id=e.id ORDER BY accepted_at DESC,id DESC LIMIT 1) u ON true
         WHERE e.reporter_member_id=$1 ORDER BY e.accepted_at DESC,e.id DESC LIMIT 1`,
        [member.member_id],
      );
      const served = new Date();
      const lease = new Date(Math.min(served.getTime() + 15000, member.expires_at.getTime()));
      if (lease <= served) throw unavailableLink();
      const fix = position.rows[0];
      return {
        displayName: member.display_name,
        rideState: 'active' as const,
        lastPosition: fix
          ? {
              lat: fix.lat,
              lon: fix.lon,
              accuracyM: fix.accuracy_m,
              recordedAt: fix.captured_at.toISOString(),
            }
          : null,
        sosState: (sos.rows[0]?.kind ??
          (sos.rows[0] ? 'open' : 'none')) as PublicStatus['sosState'],
        servedAt: served.toISOString(),
        leaseExpiresAt: lease.toISOString(),
        linkExpiresAt: member.expires_at.toISOString(),
      };
    });
  }
}

@Controller()
export class StatusLinkController {
  private readonly publicLimiter = new RideLimiter({ accountPerMinute: 120, ipPerMinute: 120 });
  constructor(
    @Inject(STATUS_LINKS)
    private readonly services: { verifier: TokenVerifier; store: StatusLinkStore } | null,
  ) {}
  private async actor(request: Request): Promise<VerifiedAccount> {
    if (!this.services) throw unavailable();
    return this.services.verifier.verify(request.headers.authorization);
  }
  @Post('rides/:rideId/status-links')
  async create(
    @Req() request: Request,
    @Param('rideId') ride: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'lifetimeHours')
    )
      throw invalid();
    const lifetime = (body as { lifetimeHours?: unknown }).lifetimeHours ?? 4;
    if (![1, 4, 8, 24].includes(lifetime as number)) throw invalid();
    const result = await this.services!.store.create(
      account,
      uuid(ride),
      uuid(String(request.headers['idempotency-key'] ?? '')),
      lifetime as number,
    );
    response.status(result.tokenAvailable ? 201 : 200);
    return { data: result, requestId: String(response.getHeader('X-Request-Id')) };
  }
  @Get('rides/:rideId/status-links')
  async list(
    @Req() request: Request,
    @Param('rideId') ride: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request);
    return {
      data: await this.services!.store.list(account, uuid(ride)),
      requestId: String(response.getHeader('X-Request-Id')),
    };
  }
  @Delete('rides/:rideId/status-links/:linkId')
  @HttpCode(204)
  async revoke(
    @Req() request: Request,
    @Param('rideId') ride: string,
    @Param('linkId') link: string,
  ) {
    await this.services!.store.revoke(await this.actor(request), uuid(ride), uuid(link));
  }
  @Get('public/status')
  async read(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (this.publicLimiter.consume('ip', request.ip ?? 'unknown') !== null)
      throw new ApiError(429, 'RATE_LIMITED', 'Try this status link again shortly.');
    if (!this.services) throw unavailable();
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer '))
      throw unavailableLink();
    return {
      data: await this.services.store.read(authorization.slice(7)),
      requestId: String(response.getHeader('X-Request-Id')),
    };
  }
  @Get('status')
  page(@Res() response: Response) {
    const nonce = randomBytes(16).toString('base64');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    response.send(statusViewerHtml(nonce));
  }
}
