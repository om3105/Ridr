import { readTrail, type TrailPage } from './trails.js';
import {
  enableSharing,
  writeSample,
  liveLocations,
  type LocationSample,
  type LocationAck,
  type LiveLocations,
} from './location.js';
import { readRoute, routeGuard, writeRoute } from './route-records.js';
import {
  osrmRouter,
  validatePoints,
  type Router,
  type RouteChange,
  type SavedRoute,
} from './route-planning.js';
import * as lifecycle from './ride-management.js';
import {
  integer,
  rideProjection,
  memberProjection,
  type RideRow,
  type MemberRow,
} from './ride-records.js';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { ApiError, inviteUnavailable, unavailable } from './api-errors.js';
import { UUID } from './auth.js';
import type { TokenVerifier, VerifiedAccount } from './auth.js';
import type { OperationalLogger } from './logging.js';
import type {
  CreatedRide,
  CreateRide,
  Invite,
  JoinRide,
  Membership,
  PhysicalRole,
  StartRide,
  EndRide,
  StopSharing,
  LeftRide,
  SharingState,
  RideManagement,
  ProposalKind,
  ProposeChange,
  AcceptChange,
  Command,
  ProposedChange,
  PreviewInvite,
  Ride,
  RideList,
  RideMembership,
  RidePreview,
  RideSnapshot,
  RideStore,
  RotateInvite,
} from './ride-types.js';

interface Receipt<T> {
  request_hash: Buffer;
  operation: string;
  result: T;
}
const rideColumns = `id, name, transport, state, leader_member_id, created_at,
  started_at, ended_at, revision, broadcast_seconds, straggler_metres`;
const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
function requestHash(method: string, path: string, body: object): Buffer {
  return hash(JSON.stringify({ method, path, body }));
}
function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'Resource not found.');
}

function redactedInvite(invite: Invite): Invite {
  return { id: invite.id, expiresAt: invite.expiresAt, tokenAvailable: false };
}

interface ListCursor {
  actor: string;
  resource: 'rides';
  order: 'createdAt,id:desc';
  createdAt: string;
  id: string;
}

function decodeCursor(cursor: string | undefined, account: VerifiedAccount): ListCursor | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as ListCursor;
    if (
      value.actor !== account.id ||
      value.resource !== 'rides' ||
      value.order !== 'createdAt,id:desc' ||
      !UUID.test(value.id) ||
      !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.createdAt) ||
      new Date(value.createdAt).toISOString() !== value.createdAt.slice(0, 23) + 'Z'
    )
      throw new Error();
    return value;
  } catch {
    throw new ApiError(400, 'INVALID_REQUEST', 'This ride list cursor is invalid.');
  }
}

export class PostgresRides implements RideStore {
  private readonly pool: Pool;

  constructor(
    databaseUrl: string,
    private readonly verifier: TokenVerifier,
    logger: OperationalLogger,
    private readonly router: Router = osrmRouter({}),
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      application_name: 'ridr-rides',
      max: 5,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 3000,
      query_timeout: 3500,
    });
    this.pool.on('error', () => logger.write('ride_pool_error'));
  }

  async registerDevice(
    account: VerifiedAccount,
    deviceId: string,
    platform: 'ios' | 'android',
  ): Promise<void> {
    await this.transaction(account, async (client) => {
      await this.lockAccount(client, account);
      const result = await client.query(
        `INSERT INTO ridr.devices (id,user_id,platform) VALUES ($1,$2,$3)
        ON CONFLICT (id) DO UPDATE SET platform=EXCLUDED.platform WHERE devices.user_id=EXCLUDED.user_id AND devices.revoked_at IS NULL RETURNING id`,
        [deviceId, account.id, platform],
      );
      if (!result.rowCount) throw new ApiError(403, 'FORBIDDEN', 'Device unavailable.');
    });
  }
  enableSharing(
    account: VerifiedAccount,
    id: string,
    change: Command & { revision: number },
  ): Promise<SharingState> {
    return this.manage(
      account,
      id,
      {
        method: 'PUT',
        path: `/v1/rides/${id}/sharing`,
        key: change.idempotencyKey,
        body: { enabled: true, revision: change.revision },
      },
      (context) => enableSharing(context, change.revision),
    );
  }
  trail(
    account: VerifiedAccount,
    id: string,
    memberId: string,
    cursor?: string,
  ): Promise<TrailPage> {
    return this.manage(account, id, null, (context) => readTrail(context, memberId, cursor));
  }

  locations(account: VerifiedAccount, id: string): Promise<LiveLocations> {
    return this.manage(account, id, null, liveLocations);
  }
  sample(
    account: VerifiedAccount,
    deviceId: string,
    sample: LocationSample,
    historical = false,
  ): Promise<LocationAck> {
    return this.manage(account, sample.rideId, null, async (context) => {
      if (!historical && (context.own.left_at || context.ride.state === 'ended')) throw notFound();
      const operation = 'location.sample';
      const digest = hash(JSON.stringify({ deviceId, sample }));
      const replay = await this.receipt<LocationAck>(
        context.client,
        account,
        sample.id,
        operation,
        digest,
      );
      if (replay) return { ...replay, status: 'duplicate' };
      const result = await writeSample(context, deviceId, sample, historical);
      await this.saveReceipt(context.client, account, sample.id, operation, digest, 200, result);
      return result;
    });
  }

  async route(account: VerifiedAccount, id: string): Promise<SavedRoute | null> {
    return (await this.manage(account, id, null, readRoute)).route;
  }
  async saveRoute(account: VerifiedAccount, id: string, change: RouteChange): Promise<SavedRoute> {
    validatePoints(change.points, change.source === 'drawn' ? 25 : 10000);
    const { idempotencyKey, ...body } = change;
    const path = `/v1/rides/${id}/route${change.source === 'gpx' ? '/import' : ''}`;
    const method = change.source === 'gpx' ? 'POST' : 'PUT';
    const prepared = await this.manage(account, id, null, async (context) => {
      if (context.own.left_at || context.ride.state === 'ended') throw notFound();
      if (context.own.id !== context.ride.leader_member_id)
        throw new ApiError(403, 'FORBIDDEN', 'Only the current leader can edit the route.');
      const replay = await this.receipt<SavedRoute>(
        context.client,
        account,
        idempotencyKey,
        `${method} ${path}`,
        requestHash(method, path, body),
      );
      if (replay) return { replay, profile: 'driving' as const };
      await routeGuard(context, change);
      return {
        replay: null,
        profile: context.ride.transport === 'cycling' ? ('cycling' as const) : ('driving' as const),
      };
    });
    if (prepared.replay) return prepared.replay;
    // Provider calls never hold ride locks. The final transaction repeats all guards.
    const points =
      change.source === 'drawn'
        ? await this.router(change.points, prepared.profile)
        : change.points;
    return this.manage(account, id, { method, path, key: idempotencyKey, body }, (context) =>
      writeRoute(context, { ...change, points }),
    );
  }

  async create(account: VerifiedAccount, change: CreateRide): Promise<CreatedRide> {
    const operation = 'POST /v1/rides';
    const digest = requestHash('POST', '/v1/rides', {
      name: change.name,
      transport: change.transport,
    });
    return this.transaction(account, async (client) => {
      await this.lockCommand(client, account, change.idempotencyKey);
      // Discover an accepted creation before taking the profile lock, preserving ride→profile order.
      const prior = await this.receipt<CreatedRide>(
        client,
        account,
        change.idempotencyKey,
        operation,
        digest,
      );
      const priorRide = prior ? await this.lockRide(client, prior.ride.id) : null;
      await this.lockAccount(client, account);
      const replay = await this.receipt<CreatedRide>(
        client,
        account,
        change.idempotencyKey,
        operation,
        digest,
      );
      if (replay) {
        if (!priorRide) throw unavailable();
        await this.currentMember(client, priorRide, account);
        return replay;
      }
      const rideId = randomUUID();
      const memberId = randomUUID();
      const created = await client.query<RideRow>(
        `INSERT INTO ridr.rides (id, name, transport, leader_member_id)
         VALUES ($1, $2, $3, $4) RETURNING ${rideColumns}`,
        [rideId, change.name.trim(), change.transport, memberId],
      );
      await client.query(
        `INSERT INTO ridr.memberships (id, ride_id, user_id, physical_role)
         VALUES ($1, $2, $3, 'rider')`,
        [memberId, rideId, account.id],
      );
      const row = created.rows[0]!;
      const membership = await this.currentMember(client, row, account);
      const invite = await this.issueInvite(client, rideId);
      const result = { ride: rideProjection(row), membership, invite };
      await this.saveReceipt(client, account, change.idempotencyKey, operation, digest, 201, {
        ...result,
        invite: redactedInvite(invite),
      });
      return result;
    });
  }

  async preview(account: VerifiedAccount, credential: PreviewInvite): Promise<RidePreview> {
    return this.transaction(account, async (client) => {
      const column = credential.code !== undefined ? 'code_hash' : 'token_hash';
      const secret = credential.code ?? credential.token!;
      const found = await client.query<{ ride_id: string }>(
        `SELECT ride_id FROM ridr.invitations WHERE ${column} = $1`,
        [hash(secret)],
      );
      if (!found.rows[0]) throw inviteUnavailable();
      const row = await this.lockRide(client, found.rows[0].ride_id, 'SHARE', inviteUnavailable);
      await this.lockAccount(client, account);
      // Re-read the credential after locking the ride: rotation/end may have committed while waiting.
      const invitation = await client.query<{ expires_at: Date }>(
        `SELECT expires_at FROM ridr.invitations WHERE ride_id = $1 AND ${column} = $2
         AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
        [row.id, hash(secret)],
      );
      if (!invitation.rows[0]) throw inviteUnavailable();
      return {
        rideId: row.id,
        rideName: row.name,
        transport: row.transport,
        state: row.state as 'lobby' | 'active',
        availableRoles: row.transport === 'motorcycle' ? ['rider', 'pillion'] : ['rider'],
        expiresAt: invitation.rows[0].expires_at.toISOString(),
      };
    });
  }

  async join(account: VerifiedAccount, rideId: string, change: JoinRide): Promise<RideMembership> {
    const path = `/v1/rides/${rideId}/join`;
    const operation = `POST ${path}`;
    const digest = requestHash('POST', path, {
      ...(change.inviteCode !== undefined
        ? { inviteCode: change.inviteCode }
        : { inviteToken: change.inviteToken }),
      physicalRole: change.physicalRole,
    });
    return this.transaction(account, async (client) => {
      await this.lockCommand(client, account, change.idempotencyKey);
      const row = await this.lockRide(client, rideId, 'UPDATE', inviteUnavailable);
      await this.lockAccount(client, account);
      const replay = await this.receipt<RideMembership>(
        client,
        account,
        change.idempotencyKey,
        operation,
        digest,
      );
      if (replay) {
        await this.currentMember(client, row, account);
        return replay;
      }
      await this.validInvite(client, rideId, change);
      if (change.physicalRole === 'pillion' && row.transport !== 'motorcycle') {
        throw new ApiError(
          422,
          'VALIDATION_FAILED',
          'Pillion is available only for motorcycle rides.',
          { physicalRole: 'Choose rider for this transport.' },
        );
      }
      const existing = await this.findMember(client, row, account.id);
      if (existing) {
        const result = { ride: rideProjection(row), membership: existing };
        await this.saveReceipt(
          client,
          account,
          change.idempotencyKey,
          operation,
          digest,
          200,
          result,
        );
        return result;
      }
      const count = await client.query<{ count: string }>(
        'SELECT count(*) AS count FROM ridr.memberships WHERE ride_id = $1 AND left_at IS NULL',
        [rideId],
      );
      if (Number(count.rows[0]!.count) >= 50) {
        throw new ApiError(409, 'RIDE_FULL', 'This ride already has 50 people.');
      }
      if (row.state === 'active') {
        const claim = await client.query(
          'SELECT 1 FROM ridr.active_memberships WHERE user_id = $1',
          [account.id],
        );
        if (claim.rowCount)
          throw new ApiError(
            409,
            'ACTIVE_RIDE_CONFLICT',
            'Leave your active ride before joining another.',
          );
      }
      const memberId = randomUUID();
      await client.query(
        `INSERT INTO ridr.memberships (id, ride_id, user_id, physical_role) VALUES ($1, $2, $3, $4)`,
        [memberId, rideId, account.id, change.physicalRole],
      );
      if (row.state === 'active') {
        await client.query(
          `INSERT INTO ridr.active_memberships (user_id, membership_id, ride_id) VALUES ($1, $2, $3)`,
          [account.id, memberId, rideId],
        );
      }
      const updated = await client.query<RideRow>(
        `UPDATE ridr.rides SET revision = revision + 1 WHERE id = $1 RETURNING ${rideColumns}`,
        [rideId],
      );
      const result = {
        ride: rideProjection(updated.rows[0]!),
        membership: await this.currentMember(client, updated.rows[0]!, account),
      };
      await this.saveReceipt(
        client,
        account,
        change.idempotencyKey,
        operation,
        digest,
        200,
        result,
      );
      return result;
    });
  }

  async read(account: VerifiedAccount, rideId: string): Promise<RideSnapshot> {
    return this.transaction(account, async (client) => {
      const row = await this.lockRide(client, rideId, 'SHARE');
      await this.lockAccount(client, account);
      const membership = await this.currentMember(client, row, account);
      const members = await client.query<MemberRow>(
        `SELECT m.*, p.display_name FROM ridr.memberships m JOIN ridr.profiles p ON p.id = m.user_id
         WHERE m.ride_id = $1 AND m.left_at IS NULL ORDER BY m.joined_at, m.id`,
        [rideId],
      );
      return {
        ride: rideProjection(row),
        membership,
        members: members.rows.map((member) => memberProjection(member, row)),
      };
    });
  }

  async list(
    account: VerifiedAccount,
    query: { limit: number; cursor?: string },
  ): Promise<RideList> {
    const cursor = decodeCursor(query.cursor, account);
    return this.transaction(account, async (client) => {
      await this.lockAccount(client, account);
      // One statement gives the collection a consistent membership/state projection.
      const rows = await client.query<
        RideRow & {
          member_id: string;
          user_id: string;
          display_name: string;
          physical_role: PhysicalRole;
          joined_at: Date;
          left_at: Date | null;
          sharing: boolean;
          consent_epoch: string;
          member_revision: string;
          cursor_created_at: string;
        }
      >(
        `SELECT r.*, m.id AS member_id, m.user_id, p.display_name, m.physical_role,
          m.joined_at, m.left_at, m.sharing, m.consent_epoch, m.revision AS member_revision,
          to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM ridr.memberships m JOIN ridr.rides r ON r.id = m.ride_id
         JOIN ridr.profiles p ON p.id = m.user_id
         WHERE m.user_id = $1 AND m.left_at IS NULL AND r.state IN ('lobby', 'active')
           AND ($2::timestamptz IS NULL OR (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
         ORDER BY r.created_at DESC, r.id DESC LIMIT $4`,
        [account.id, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      );
      const page = rows.rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          ride: rideProjection(row),
          membership: memberProjection(
            {
              ...row,
              id: row.member_id,
              ride_id: row.id,
              revision: row.member_revision,
            },
            row,
          ),
        })),
        nextCursor:
          rows.rows.length > query.limit && last
            ? Buffer.from(
                JSON.stringify({
                  actor: account.id,
                  resource: 'rides',
                  order: 'createdAt,id:desc',
                  createdAt: last.cursor_created_at,
                  id: last.id,
                } satisfies ListCursor),
              ).toString('base64url')
            : null,
      };
    });
  }

  async rotate(account: VerifiedAccount, rideId: string, change: RotateInvite): Promise<Invite> {
    const path = `/v1/rides/${rideId}/invites`;
    const operation = `POST ${path}`;
    const digest = requestHash('POST', path, {
      rotate: true,
      ...(change.motion ? { motion: change.motion, capturedAt: change.capturedAt } : {}),
    });
    return this.transaction(account, async (client) => {
      await this.lockCommand(client, account, change.idempotencyKey);
      const row = await this.lockRide(client, rideId);
      await this.lockAccount(client, account);
      await this.requireLeader(client, row, account);
      const replay = await this.receipt<Invite>(
        client,
        account,
        change.idempotencyKey,
        operation,
        digest,
      );
      if (replay) return replay;
      if (row.state === 'active') {
        if (!change.motion || !change.capturedAt)
          throw new ApiError(
            409,
            'MOTION_RESTRICTED',
            'An active ride requires a fresh stopped motion check.',
          );
        const member = await this.currentMember(client, row, account);
        await lifecycle.stationary(client, member.id, {
          motion: change.motion,
          capturedAt: change.capturedAt,
        });
      }
      if (integer(row.revision) !== change.revision) {
        throw new ApiError(
          412,
          'REVISION_CONFLICT',
          'This ride changed. Reload it before rotating the invite.',
        );
      }
      await client.query(
        'UPDATE ridr.invitations SET revoked_at = clock_timestamp() WHERE ride_id = $1 AND revoked_at IS NULL',
        [rideId],
      );
      const invite = await this.issueInvite(client, rideId);
      await client.query('UPDATE ridr.rides SET revision = revision + 1 WHERE id = $1', [rideId]);
      await this.saveReceipt(
        client,
        account,
        change.idempotencyKey,
        operation,
        digest,
        201,
        redactedInvite(invite),
      );
      return invite;
    });
  }

  async revoke(
    account: VerifiedAccount,
    rideId: string,
    change: { idempotencyKey: string },
  ): Promise<void> {
    const path = `/v1/rides/${rideId}/invites/current`;
    const operation = `DELETE ${path}`;
    const digest = requestHash('DELETE', path, {});
    await this.transaction(account, async (client) => {
      await this.lockCommand(client, account, change.idempotencyKey);
      const row = await this.lockRide(client, rideId);
      await this.lockAccount(client, account);
      await this.requireLeader(client, row, account);
      if (await this.receipt<object>(client, account, change.idempotencyKey, operation, digest))
        return;
      const revoked = await client.query(
        'UPDATE ridr.invitations SET revoked_at = clock_timestamp() WHERE ride_id = $1 AND revoked_at IS NULL',
        [rideId],
      );
      if (revoked.rowCount)
        await client.query('UPDATE ridr.rides SET revision = revision + 1 WHERE id = $1', [rideId]);
      await this.saveReceipt(client, account, change.idempotencyKey, operation, digest, 204, {});
    });
  }

  private async manage<T extends object>(
    account: VerifiedAccount,
    id: string,
    command: { method: string; path: string; key: string; body: object; status?: number } | null,
    action: (context: lifecycle.ManagementContext) => Promise<T>,
  ): Promise<T> {
    return this.transaction(account, async (client) => {
      if (command) await this.lockCommand(client, account, command.key);
      const row = await this.lockRide(client, id, 'UPDATE', notFound, true);
      // Never take the actor's profile first: two lobbies may contain the same people.
      const profiles = await client.query<{
        id: string;
        account_state: string;
        deleted_at: Date | null;
      }>(
        `SELECT id, account_state, deleted_at FROM ridr.profiles WHERE id = $2 OR id IN
          (SELECT user_id FROM ridr.memberships WHERE ride_id = $1 AND left_at IS NULL)
         ORDER BY id FOR UPDATE`,
        [id, account.id],
      );
      const actor = profiles.rows.find((profile) => profile.id === account.id);
      if (actor && (actor.account_state !== 'active' || actor.deleted_at !== null))
        throw new ApiError(403, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable.');
      const members = await client.query<MemberRow>(
        `SELECT m.*, p.display_name FROM ridr.memberships m JOIN ridr.profiles p ON p.id = m.user_id
         WHERE m.ride_id = $1 AND (m.left_at IS NULL OR m.user_id = $2)
         ORDER BY m.id FOR UPDATE OF m`,
        [id, account.id],
      );
      const own =
        members.rows
          .filter((member) => member.user_id === account.id)
          .sort((a, b) => b.joined_at.getTime() - a.joined_at.getTime() || b.id.localeCompare(a.id))
          .find((member) => !member.left_at) ??
        members.rows
          .filter((member) => member.user_id === account.id)
          .sort(
            (a, b) => b.joined_at.getTime() - a.joined_at.getTime() || b.id.localeCompare(a.id),
          )[0];
      if (!actor || !own) throw notFound();
      const privacy = command && /\/(end|leave|sharing)$/.test(command.path);
      if (command && !privacy && (row.state === 'ended' || own.left_at)) throw notFound();
      const operation = command ? `${command.method} ${command.path}` : '';
      const digest = command
        ? requestHash(command.method, command.path, command.body)
        : Buffer.alloc(0);
      if (command) {
        const replay = await this.receipt<T>(client, account, command.key, operation, digest);
        if (replay) return replay;
      }
      const result = await action({ client, ride: row, members: members.rows, own });
      if (command)
        await this.saveReceipt(
          client,
          account,
          command.key,
          operation,
          digest,
          command.status ?? 200,
          result,
        );
      return result;
    });
  }

  start(account: VerifiedAccount, id: string, change: StartRide): Promise<Ride> {
    const { idempotencyKey, revision, ...body } = change;
    return this.manage(
      account,
      id,
      {
        method: 'POST',
        path: `/v1/rides/${id}/start`,
        key: idempotencyKey,
        body: { ...body, revision },
      },
      (context) => lifecycle.startRide(context, change),
    );
  }
  end(account: VerifiedAccount, id: string, change: EndRide): Promise<Ride> {
    const { idempotencyKey, ...body } = change;
    return this.manage(
      account,
      id,
      { method: 'POST', path: `/v1/rides/${id}/end`, key: idempotencyKey, body },
      (context) => lifecycle.endRide(context, change),
    );
  }
  leave(account: VerifiedAccount, id: string, change: StopSharing): Promise<LeftRide> {
    const { idempotencyKey, ...body } = change;
    return this.manage(
      account,
      id,
      { method: 'POST', path: `/v1/rides/${id}/leave`, key: idempotencyKey, body },
      (context) => lifecycle.leaveRide(context, change),
    );
  }
  stopSharing(account: VerifiedAccount, id: string, change: StopSharing): Promise<SharingState> {
    const { idempotencyKey, ...body } = change;
    return this.manage(
      account,
      id,
      {
        method: 'PUT',
        path: `/v1/rides/${id}/sharing`,
        key: idempotencyKey,
        body: { enabled: false, ...body },
      },
      (context) => lifecycle.stopSharing(context, change),
    );
  }
  management(account: VerifiedAccount, id: string): Promise<RideManagement> {
    return this.manage(account, id, null, lifecycle.management);
  }
  propose(
    account: VerifiedAccount,
    id: string,
    kind: ProposalKind,
    change: ProposeChange,
  ): Promise<ProposedChange> {
    const { idempotencyKey, revision, ...body } = change;
    const resource = kind === 'leadership' ? 'leadership-proposals' : 'role-proposals';
    return this.manage(
      account,
      id,
      {
        method: 'POST',
        path: `/v1/rides/${id}/${resource}`,
        key: idempotencyKey,
        body: { ...body, revision },
        status: 201,
      },
      (context) => lifecycle.propose(context, kind, change),
    );
  }
  accept(
    account: VerifiedAccount,
    id: string,
    proposalId: string,
    kind: ProposalKind,
    change: AcceptChange,
  ): Promise<Ride | Membership> {
    const { idempotencyKey, ...body } = change;
    const resource = kind === 'leadership' ? 'leadership-proposals' : 'role-proposals';
    return this.manage(
      account,
      id,
      {
        method: 'POST',
        path: `/v1/rides/${id}/${resource}/${proposalId}/accept`,
        key: idempotencyKey,
        body,
      },
      (context) => lifecycle.accept(context, proposalId, kind, change),
    );
  }
  async cancel(
    account: VerifiedAccount,
    id: string,
    proposalId: string,
    kind: ProposalKind,
    change: Command,
  ): Promise<void> {
    const resource = kind === 'leadership' ? 'leadership-proposals' : 'role-proposals';
    await this.manage(
      account,
      id,
      {
        method: 'DELETE',
        path: `/v1/rides/${id}/${resource}/${proposalId}`,
        key: change.idempotencyKey,
        body: {},
        status: 204,
      },
      async (context) => {
        await lifecycle.cancel(context, proposalId, kind);
        return {};
      },
    );
  }

  private async lockCommand(
    client: PoolClient,
    account: VerifiedAccount,
    key: string,
  ): Promise<void> {
    // Same-key creation retries must discover their ride before locking a profile.
    // Profile mutations share the profile lock and receipt primary key across features.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${account.id}:${key}`,
    ]);
  }

  private async lockAccount(client: PoolClient, account: VerifiedAccount): Promise<void> {
    await client.query(
      'INSERT INTO ridr.profiles (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [account.id, account.initialDisplayName],
    );
    const result = await client.query<{ account_state: string; deleted_at: Date | null }>(
      'SELECT account_state, deleted_at FROM ridr.profiles WHERE id = $1 FOR UPDATE',
      [account.id],
    );
    if (result.rows[0]?.account_state !== 'active' || result.rows[0].deleted_at !== null) {
      throw new ApiError(403, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable.');
    }
  }

  private async lockRide(
    client: PoolClient,
    rideId: string,
    lock: 'UPDATE' | 'SHARE' = 'UPDATE',
    missing = notFound,
    allowEnded = false,
  ): Promise<RideRow> {
    const result = await client.query<RideRow>(
      `SELECT ${rideColumns} FROM ridr.rides WHERE id = $1 FOR ${lock}`,
      [rideId],
    );
    const row = result.rows[0];
    if (!row || (!allowEnded && row.state === 'ended')) throw missing();
    return row;
  }

  private async findMember(
    client: PoolClient,
    row: RideRow,
    userId: string,
  ): Promise<Membership | null> {
    const result = await client.query<MemberRow>(
      `SELECT m.*, p.display_name FROM ridr.memberships m JOIN ridr.profiles p ON p.id = m.user_id
       WHERE m.ride_id = $1 AND m.user_id = $2 AND m.left_at IS NULL`,
      [row.id, userId],
    );
    return result.rows[0] ? memberProjection(result.rows[0], row) : null;
  }

  private async currentMember(
    client: PoolClient,
    row: RideRow,
    account: VerifiedAccount,
  ): Promise<Membership> {
    const member = await this.findMember(client, row, account.id);
    if (!member) throw notFound();
    return member;
  }

  private async requireLeader(
    client: PoolClient,
    row: RideRow,
    account: VerifiedAccount,
  ): Promise<void> {
    const member = await this.currentMember(client, row, account);
    if (member.id !== row.leader_member_id)
      throw new ApiError(403, 'FORBIDDEN', 'Only the ride leader can manage invitations.');
  }

  private async validInvite(client: PoolClient, rideId: string, change: JoinRide): Promise<void> {
    const column = change.inviteCode !== undefined ? 'code_hash' : 'token_hash';
    const secret = change.inviteCode ?? change.inviteToken;
    if (!secret) throw inviteUnavailable();
    const result = await client.query(
      `SELECT 1 FROM ridr.invitations WHERE ride_id = $1 AND ${column} = $2
       AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
      [rideId, hash(secret)],
    );
    if (!result.rowCount) throw inviteUnavailable();
  }

  private async issueInvite(client: PoolClient, rideId: string): Promise<Invite> {
    const token = randomBytes(32).toString('base64url');
    const code = Array.from(
      { length: 10 },
      () => codeAlphabet[randomInt(codeAlphabet.length)],
    ).join('');
    const result = await client.query<{ id: string; expires_at: Date }>(
      `INSERT INTO ridr.invitations (id, ride_id, token_hash, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '24 hours') RETURNING id, expires_at`,
      [randomUUID(), rideId, hash(token), hash(code)],
    );
    return {
      id: result.rows[0]!.id,
      code,
      url: `ridr://join?token=${token}`,
      expiresAt: result.rows[0]!.expires_at.toISOString(),
      tokenAvailable: true,
    };
  }

  private async receipt<T>(
    client: PoolClient,
    account: VerifiedAccount,
    key: string,
    operation: string,
    digest: Buffer,
  ): Promise<T | null> {
    const result = await client.query<Receipt<T>>(
      'SELECT operation, request_hash, result FROM ridr.command_receipts WHERE actor_id = $1 AND command_id = $2',
      [account.id, key],
    );
    const receipt = result.rows[0];
    if (!receipt) return null;
    if (receipt.operation !== operation || !digest.equals(receipt.request_hash)) {
      throw new ApiError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This request key was already used for a different change.',
      );
    }
    return receipt.result;
  }

  private async saveReceipt(
    client: PoolClient,
    account: VerifiedAccount,
    key: string,
    operation: string,
    digest: Buffer,
    status: number,
    result: object,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ridr.command_receipts (actor_id, command_id, operation, request_hash, http_status, result, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + interval '24 hours')`,
      [account.id, key, operation, digest, status, JSON.stringify(result)],
    );
  }

  private async transaction<T>(
    account: VerifiedAccount,
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    try {
      await client.query('BEGIN');
      const result = await action(client);
      // The locked profile prevents a concurrent account deletion passing this point.
      // Provider sessions can be revoked while work waits on ride/account locks.
      await this.verifier.assertActive(account);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ApiError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'constraint' in error &&
        error.constraint === 'active_memberships_pkey'
      ) {
        throw new ApiError(
          409,
          'ACTIVE_RIDE_CONFLICT',
          'Leave your active ride before joining another.',
        );
      }
      throw unavailable();
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
