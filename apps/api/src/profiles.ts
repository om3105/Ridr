import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { TokenVerifier, VerifiedAccount } from './auth.js';
import { ApiError, unavailable } from './api-errors.js';
import type { OperationalLogger } from './logging.js';

export interface Profile {
  id: string;
  displayName: string;
  createdAt: string;
  revision: number;
  activeMembership: null | {
    id: string;
    rideId: string;
    profileId: string;
    displayName: string;
    role: 'leader' | 'rider' | 'pillion';
    physicalRole: 'rider' | 'pillion';
    joinedAt: string;
    leftAt: null;
    sharingEnabled: boolean;
    consentEpoch: number;
    revision: number;
  };
  entitlement: { adFree: boolean; evaluatedAt: string };
  deletionState: 'none';
}

export interface ProfileChange {
  displayName: string;
  revision: number;
  idempotencyKey: string;
}

export interface ProfileStore {
  read(account: VerifiedAccount): Promise<Profile>;
  update(account: VerifiedAccount, change: ProfileChange): Promise<Profile>;
  close(): Promise<void>;
}

interface ProfileRow {
  id: string;
  display_name: string;
  created_at: Date;
  revision: string;
  account_state: string;
  deleted_at: Date | null;
}

function revisionNumber(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw unavailable();
  return result;
}

export function profileRequestHash(displayName: string): Buffer {
  return createHash('sha256')
    .update(
      JSON.stringify({
        method: 'PATCH',
        path: '/v1/me',
        body: { displayName },
      }),
    )
    .digest();
}

export class PostgresProfiles implements ProfileStore {
  private readonly pool: Pool;

  constructor(
    databaseUrl: string,
    private readonly verifier: TokenVerifier,
    logger: OperationalLogger,
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      application_name: 'ridr-profiles',
      max: 5,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 3000,
      query_timeout: 3500,
    });
    this.pool.on('error', () => logger.write('profile_pool_error'));
  }

  async read(account: VerifiedAccount): Promise<Profile> {
    return this.withAccount(account, (client, row) => this.project(client, row));
  }

  async update(account: VerifiedAccount, change: ProfileChange): Promise<Profile> {
    return this.withAccount(account, async (client, row) => {
      const digest = profileRequestHash(change.displayName);
      // The account row lock serializes profile commands and duplicate receipts.
      // Replay must precede the revision check, including after a newer accepted edit.
      const receipt = await client.query<{
        request_hash: Buffer;
        operation: string;
        result: Profile;
      }>(
        `SELECT request_hash, operation, result FROM ridr.command_receipts
         WHERE actor_id = $1 AND command_id = $2`,
        [account.id, change.idempotencyKey],
      );
      const accepted = receipt.rows[0];
      if (accepted) {
        if (accepted.operation !== 'PATCH /v1/me' || !digest.equals(accepted.request_hash)) {
          throw new ApiError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This request key was already used for a different change.',
          );
        }
        return accepted.result;
      }
      if (revisionNumber(row.revision) !== change.revision) {
        throw new ApiError(
          412,
          'REVISION_CONFLICT',
          'Your profile changed. Reload it before saving again.',
        );
      }
      const updated = await client.query<ProfileRow>(
        `UPDATE ridr.profiles SET display_name = $2, revision = revision + 1
         WHERE id = $1 RETURNING id, display_name, created_at, revision, account_state, deleted_at`,
        [account.id, change.displayName.trim()],
      );
      const profile = await this.project(client, updated.rows[0]!);
      await client.query(
        `INSERT INTO ridr.command_receipts
         (actor_id, command_id, operation, request_hash, http_status, result, expires_at)
         VALUES ($1, $2, 'PATCH /v1/me', $3, 200, $4, now() + interval '24 hours')`,
        [account.id, change.idempotencyKey, digest, JSON.stringify(profile)],
      );
      return profile;
    });
  }

  private async withAccount(
    account: VerifiedAccount,
    action: (client: PoolClient, row: ProfileRow) => Promise<Profile>,
  ): Promise<Profile> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ridr.profiles (id, display_name) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [account.id, account.initialDisplayName],
      );
      const result = await client.query<ProfileRow>(
        `SELECT id, display_name, created_at, revision, account_state, deleted_at
         FROM ridr.profiles WHERE id = $1 FOR UPDATE`,
        [account.id],
      );
      const row = result.rows[0];
      if (!row || row.account_state !== 'active' || row.deleted_at !== null) {
        throw new ApiError(403, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable.');
      }
      const profile = await action(client, row);
      // Recheck after acquiring locks/work: queued requests must not bypass sign-out.
      // Account deletion serializes on the same locked profile row.
      await this.verifier.assertActive(account);
      await client.query('COMMIT');
      return profile;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      client.release();
    }
  }

  private async project(client: PoolClient, row: ProfileRow): Promise<Profile> {
    const membership = await client.query<{
      id: string;
      ride_id: string;
      physical_role: 'rider' | 'pillion';
      joined_at: Date;
      sharing: boolean;
      consent_epoch: string;
      revision: string;
      role: 'leader' | 'rider' | 'pillion';
    }>(
      `SELECT m.id, m.ride_id, m.physical_role, m.joined_at, m.sharing,
         m.consent_epoch, m.revision,
         CASE WHEN r.leader_member_id = m.id THEN 'leader' ELSE m.physical_role END AS role
       FROM ridr.active_memberships a
       JOIN ridr.memberships m ON m.id = a.membership_id AND m.user_id = a.user_id AND m.ride_id = a.ride_id
       JOIN ridr.rides r ON r.id = m.ride_id
       WHERE a.user_id = $1 AND m.left_at IS NULL AND r.state = 'active'`,
      [row.id],
    );
    const entitlement = await client.query<{ ad_free: boolean; evaluated_at: Date }>(
      `SELECT EXISTS (SELECT 1 FROM ridr.ad_entitlements WHERE user_id = $1 AND ad_free_until > now()) AS ad_free,
       now() AS evaluated_at`,
      [row.id],
    );
    const active = membership.rows[0];
    const ad = entitlement.rows[0]!;
    return {
      id: row.id,
      displayName: row.display_name,
      createdAt: row.created_at.toISOString(),
      revision: revisionNumber(row.revision),
      activeMembership: active
        ? {
            id: active.id,
            rideId: active.ride_id,
            profileId: row.id,
            displayName: row.display_name,
            role: active.role,
            physicalRole: active.physical_role,
            joinedAt: active.joined_at.toISOString(),
            leftAt: null,
            sharingEnabled: active.sharing,
            consentEpoch: revisionNumber(active.consent_epoch),
            revision: revisionNumber(active.revision),
          }
        : null,
      entitlement: { adFree: ad.ad_free, evaluatedAt: ad.evaluated_at.toISOString() },
      deletionState: 'none',
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
