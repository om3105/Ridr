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
  PreviewInvite,
  Ride,
  RideList,
  RideMembership,
  RidePreview,
  RideSnapshot,
  RideStore,
  RotateInvite,
} from './ride-types.js';

interface RideRow {
  id: string;
  name: string;
  transport: Ride['transport'];
  state: Ride['state'];
  leader_member_id: string;
  created_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  revision: string;
  broadcast_seconds: 5 | 10 | 15;
  straggler_metres: number;
}

interface MemberRow {
  id: string;
  ride_id: string;
  user_id: string;
  display_name: string;
  physical_role: PhysicalRole;
  joined_at: Date;
  left_at: Date | null;
  sharing: boolean;
  consent_epoch: string;
  revision: string;
}

interface Receipt<T> {
  request_hash: Buffer;
  operation: string;
  result: T;
}

const rideColumns = `id, name, transport, state, leader_member_id, created_at,
  started_at, ended_at, revision, broadcast_seconds, straggler_metres`;
const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function integer(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw unavailable();
  return result;
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function requestHash(method: string, path: string, body: object): Buffer {
  return hash(JSON.stringify({ method, path, body }));
}

function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'Resource not found.');
}

function rideProjection(row: RideRow): Ride {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    state: row.state,
    leaderMemberId: row.leader_member_id,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    revision: integer(row.revision),
    settings: {
      broadcastIntervalSeconds: row.broadcast_seconds,
      stragglerDistanceM: row.straggler_metres,
    },
  };
}

function memberProjection(row: MemberRow, ride: RideRow): Membership {
  return {
    id: row.id,
    rideId: row.ride_id,
    profileId: row.user_id,
    displayName: row.display_name,
    role: row.id === ride.leader_member_id ? 'leader' : row.physical_role,
    physicalRole: row.physical_role,
    joinedAt: row.joined_at.toISOString(),
    leftAt: row.left_at?.toISOString() ?? null,
    sharingEnabled: row.sharing,
    consentEpoch: integer(row.consent_epoch),
    revision: integer(row.revision),
  };
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
    const digest = requestHash('POST', path, { rotate: true });
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
      if (row.state !== 'lobby')
        throw new ApiError(409, 'STATE_CONFLICT', 'Invite rotation is available in the lobby.');
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
  ): Promise<RideRow> {
    const result = await client.query<RideRow>(
      `SELECT ${rideColumns} FROM ridr.rides WHERE id = $1 FOR ${lock}`,
      [rideId],
    );
    const row = result.rows[0];
    if (!row || row.state === 'ended') throw missing();
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
