import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { ApiError, unauthenticated } from '../src/api-errors.js';
import type { TokenVerifier, VerifiedAccount } from '../src/auth.js';
import { OperationalLogger } from '../src/logging.js';
import { PostgresProfiles } from '../src/profiles.js';
import { PostgresRides } from '../src/ride-store.js';
import type { CreatedRide, JoinRide, Transport } from '../src/ride-types.js';
import { parseJoin, parsePreview } from '../src/rides.js';

function rejectsCode(code: string, status?: number): (error: unknown) => boolean {
  return (error) =>
    error instanceof ApiError &&
    error.code === code &&
    (status === undefined || error.status === status);
}

// Explicit local/test runtime database only; fake session authority sends no email or provider requests.
test('PostgreSQL ride transactions enforce invitation, membership and concurrent join rules', async (t) => {
  assert.equal(process.env.NODE_ENV, 'test', 'Ride integration checks require NODE_ENV=test.');
  assert.ok(process.env.DATABASE_URL, 'Ride integration checks require DATABASE_URL.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const actors: string[] = [];
  const revokedSessions = new Set<string>();
  const logs: string[] = [];
  const account = (name = 'Test rider'): VerifiedAccount => {
    const actor = {
      id: randomUUID(),
      sessionId: randomUUID(),
      initialDisplayName: name,
      expiresAt: Date.now() / 1000 + 300,
    };
    actors.push(actor.id);
    return actor;
  };
  const verifier: TokenVerifier = {
    verify: async () => {
      throw new Error('Integration tests call the store with verified accounts.');
    },
    assertActive: async (actor) => {
      if (revokedSessions.has(actor.sessionId)) throw unauthenticated();
    },
    close: async () => undefined,
  };
  const logger = new OperationalLogger((line) => logs.push(line));
  const rides = new PostgresRides(process.env.DATABASE_URL, verifier, logger);
  const profiles = new PostgresProfiles(process.env.DATABASE_URL, verifier, logger);
  const create = (leader: VerifiedAccount, transport: Transport = 'motorcycle') =>
    rides.create(leader, { name: 'Morning ride', transport, idempotencyKey: randomUUID() });
  const joinChange = (created: CreatedRide, extra: Partial<JoinRide> = {}): JoinRide => ({
    inviteCode: created.invite.code!,
    physicalRole: 'rider',
    idempotencyKey: randomUUID(),
    ...extra,
  });
  const startFixture = async (rideId: string) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE ridr.rides SET state = 'active', started_at = clock_timestamp() WHERE id = $1",
        [rideId],
      );
      await client.query(
        `INSERT INTO ridr.active_memberships (user_id, membership_id, ride_id)
         SELECT user_id, id, ride_id FROM ridr.memberships WHERE ride_id = $1 AND left_at IS NULL`,
        [rideId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  t.after(async () => {
    await Promise.all([rides.close(), profiles.close()]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query<{ id: string }>(
        `SELECT r.id FROM ridr.rides r JOIN ridr.memberships m ON m.id = r.leader_member_id
         WHERE m.user_id = ANY($1::uuid[])`,
        [actors],
      );
      const rideIds = created.rows.map((row) => row.id);
      await client.query('DELETE FROM ridr.command_receipts WHERE actor_id = ANY($1::uuid[])', [
        actors,
      ]);
      await client.query('DELETE FROM ridr.active_memberships WHERE ride_id = ANY($1::uuid[])', [
        rideIds,
      ]);
      await client.query('DELETE FROM ridr.invitations WHERE ride_id = ANY($1::uuid[])', [rideIds]);
      await client.query('DELETE FROM ridr.memberships WHERE ride_id = ANY($1::uuid[])', [rideIds]);
      await client.query('DELETE FROM ridr.rides WHERE id = ANY($1::uuid[])', [rideIds]);
      await client.query('DELETE FROM ridr.profiles WHERE id = ANY($1::uuid[])', [actors]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  });

  await t.test(
    'creation is atomic, concurrent replay is redacted, and keys are shared with profiles',
    async () => {
      const leader = account('Mira');
      const change = {
        name: '  Dawn ride  ',
        transport: 'motorcycle' as const,
        idempotencyKey: randomUUID(),
      };
      const results = await Promise.all([
        rides.create(leader, change),
        rides.create(leader, change),
      ]);
      const first = results.find((result) => result.invite.tokenAvailable)!;
      const replay = results.find((result) => !result.invite.tokenAvailable)!;
      assert.ok(first && replay);
      assert.equal(first.ride.name, 'Dawn ride');
      assert.equal(first.ride.state, 'lobby');
      assert.equal(first.ride.leaderMemberId, first.membership.id);
      assert.equal(first.membership.role, 'leader');
      assert.equal(first.membership.physicalRole, 'rider');
      assert.equal(first.membership.sharingEnabled, false);
      assert.equal(first.membership.consentEpoch, 0);
      assert.equal(first.ride.startedAt, null);
      assert.equal(first.ride.revision, 1);
      assert.deepEqual(replay, {
        ...first,
        invite: { id: first.invite.id, expiresAt: first.invite.expiresAt, tokenAvailable: false },
      });
      assert.match(first.invite.code!, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);
      const token = new URL(first.invite.url!).searchParams.get('token')!;
      assert.equal(Buffer.from(token, 'base64url').byteLength, 32);
      const invitation = await pool.query<{
        token_hash: Buffer;
        code_hash: Buffer;
        lifetime: string;
      }>(
        'SELECT token_hash, code_hash, (expires_at - created_at)::text AS lifetime FROM ridr.invitations WHERE ride_id = $1',
        [first.ride.id],
      );
      assert.equal(invitation.rowCount, 1);
      assert.deepEqual(invitation.rows[0]!.token_hash, createHash('sha256').update(token).digest());
      assert.deepEqual(
        invitation.rows[0]!.code_hash,
        createHash('sha256').update(first.invite.code!).digest(),
      );
      assert.equal(invitation.rows[0]!.lifetime, '1 day');
      const persisted = await pool.query(
        'SELECT result FROM ridr.command_receipts WHERE actor_id = $1',
        [leader.id],
      );
      assert.equal(persisted.rowCount, 1);
      for (const secret of [token, first.invite.code!]) {
        assert.ok(!JSON.stringify(persisted.rows).includes(secret));
        assert.ok(!logs.join('\n').includes(secret));
      }
      const claims = await pool.query('SELECT 1 FROM ridr.active_memberships WHERE user_id = $1', [
        leader.id,
      ]);
      assert.equal(claims.rowCount, 0);
      await assert.rejects(
        rides.create(leader, { ...change, name: 'Changed' }),
        rejectsCode('IDEMPOTENCY_CONFLICT', 409),
      );
      await assert.rejects(
        profiles.update(leader, {
          displayName: 'Ren',
          revision: 1,
          idempotencyKey: change.idempotencyKey,
        }),
        rejectsCode('IDEMPOTENCY_CONFLICT'),
      );
      const profileKey = randomUUID();
      await profiles.update(leader, {
        displayName: 'Mira D',
        revision: 1,
        idempotencyKey: profileKey,
      });
      await assert.rejects(
        rides.create(leader, { ...change, idempotencyKey: profileKey }),
        rejectsCode('IDEMPOTENCY_CONFLICT'),
      );
      await pool.query('UPDATE ridr.memberships SET left_at = clock_timestamp() WHERE id = $1', [
        first.membership.id,
      ]);
      await assert.rejects(rides.create(leader, change), rejectsCode('NOT_FOUND', 404));
    },
  );

  await t.test(
    'preview reveals no members; explicit and repeated joins preserve one sharing-off membership',
    async () => {
      const leader = account('Leader');
      const guest = account('Guest');
      const outsider = account('Outsider');
      const created = await create(leader);
      const token = new URL(created.invite.url!).searchParams.get('token')!;
      const preview = await rides.preview(guest, { token });
      assert.deepEqual(Object.keys(preview).sort(), [
        'availableRoles',
        'expiresAt',
        'rideId',
        'rideName',
        'state',
        'transport',
      ]);
      assert.deepEqual(preview.availableRoles, ['rider', 'pillion']);
      assert.deepEqual(preview, await rides.preview(guest, { code: created.invite.code! }));
      assert.equal((await rides.list(guest, { limit: 50 })).items.length, 0);
      await assert.rejects(rides.read(guest, created.ride.id), rejectsCode('NOT_FOUND', 404));
      const change = joinChange(created, { physicalRole: 'pillion' });
      const joined = await Promise.all([
        rides.join(guest, created.ride.id, change),
        rides.join(guest, created.ride.id, { ...change, idempotencyKey: randomUUID() }),
      ]);
      assert.equal(joined[0]!.membership.id, joined[1]!.membership.id);
      assert.equal(joined[0]!.membership.role, 'pillion');
      assert.equal(joined[0]!.membership.sharingEnabled, false);
      assert.equal(joined[0]!.ride.revision, 2);
      assert.deepEqual(await rides.join(guest, created.ride.id, change), joined[0]);
      await assert.rejects(
        rides.join(guest, created.ride.id, { ...change, physicalRole: 'rider' }),
        rejectsCode('IDEMPOTENCY_CONFLICT'),
      );
      const snapshot = await rides.read(guest, created.ride.id);
      assert.equal(snapshot.members.length, 2);
      assert.equal(snapshot.members.filter((member) => member.role === 'leader').length, 1);
      assert.ok(!JSON.stringify(snapshot).includes(created.invite.code!));
      await assert.rejects(rides.read(outsider, created.ride.id), rejectsCode('NOT_FOUND'));
      assert.equal((await rides.list(outsider, { limit: 50 })).items.length, 0);
      const car = await create(leader, 'car');
      assert.deepEqual((await rides.preview(guest, { code: car.invite.code! })).availableRoles, [
        'rider',
      ]);
      await assert.rejects(
        rides.join(guest, car.ride.id, joinChange(car, { physicalRole: 'pillion' })),
        rejectsCode('VALIDATION_FAILED', 422),
      );
      await pool.query('UPDATE ridr.memberships SET left_at = clock_timestamp() WHERE id = $1', [
        joined[0]!.membership.id,
      ]);
      await assert.rejects(rides.read(guest, created.ride.id), rejectsCode('NOT_FOUND'));
      await assert.rejects(rides.join(guest, created.ride.id, change), rejectsCode('NOT_FOUND'));
    },
  );

  await t.test(
    'invalid, expired, revoked and ended invitations have the same non-enumerating response',
    async () => {
      const leader = account();
      const guest = account();
      const expired = await create(leader);
      await pool.query(
        `UPDATE ridr.invitations SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
       WHERE ride_id = $1`,
        [expired.ride.id],
      );
      const revoked = await create(leader);
      await rides.revoke(leader, revoked.ride.id, { idempotencyKey: randomUUID() });
      const ended = await create(leader);
      await pool.query(
        "UPDATE ridr.rides SET state = 'ended', ended_at = clock_timestamp() WHERE id = $1",
        [ended.ride.id],
      );
      const unavailable = {
        status: 404,
        code: 'INVITE_UNAVAILABLE',
        message: 'This invitation is unavailable. Ask the leader for a new one.',
      };
      assert.throws(() => parsePreview({ code: 'invalid' }), unavailable);
      assert.throws(
        () => parseJoin({ inviteCode: 'invalid', physicalRole: 'rider' }, randomUUID()),
        unavailable,
      );
      for (const created of [expired, revoked, ended]) {
        await assert.rejects(rides.preview(guest, { code: created.invite.code! }), unavailable);
        await assert.rejects(rides.join(guest, created.ride.id, joinChange(created)), unavailable);
      }
      await assert.rejects(rides.preview(guest, { code: 'XXXXXXXXXX' }), unavailable);
      await assert.rejects(rides.join(guest, randomUUID(), joinChange(expired)), unavailable);
      assert.equal((await rides.list(guest, { limit: 50 })).items.length, 0);
    },
  );

  await t.test(
    'blocked accounts and a session revoked at commit roll back every write and receipt',
    async () => {
      const leader = account();
      const created = await create(leader);
      const denied = account();
      revokedSessions.add(denied.sessionId);
      const failedCreation = randomUUID();
      await assert.rejects(
        rides.create(denied, {
          name: 'Must roll back',
          transport: 'cycling',
          idempotencyKey: failedCreation,
        }),
        rejectsCode('UNAUTHENTICATED', 401),
      );
      const profile = await pool.query('SELECT 1 FROM ridr.profiles WHERE id = $1', [denied.id]);
      assert.equal(profile.rowCount, 0);
      const deniedKey = randomUUID();
      await assert.rejects(
        rides.join(denied, created.ride.id, joinChange(created, { idempotencyKey: deniedKey })),
        rejectsCode('UNAUTHENTICATED'),
      );
      assert.equal((await rides.read(leader, created.ride.id)).ride.revision, 1);
      const rejectedReceipts = await pool.query(
        'SELECT 1 FROM ridr.command_receipts WHERE actor_id = $1',
        [denied.id],
      );
      assert.equal(rejectedReceipts.rowCount, 0);
      const revokedLeaderSession = { ...leader, sessionId: randomUUID() };
      revokedSessions.add(revokedLeaderSession.sessionId);
      const rotateKey = randomUUID();
      const revokeKey = randomUUID();
      await assert.rejects(
        rides.rotate(revokedLeaderSession, created.ride.id, {
          revision: 1,
          idempotencyKey: rotateKey,
        }),
        rejectsCode('UNAUTHENTICATED', 401),
      );
      await assert.rejects(
        rides.revoke(revokedLeaderSession, created.ride.id, { idempotencyKey: revokeKey }),
        rejectsCode('UNAUTHENTICATED', 401),
      );
      assert.equal((await rides.read(leader, created.ride.id)).ride.revision, 1);
      assert.equal(
        (await rides.preview(leader, { code: created.invite.code! })).rideId,
        created.ride.id,
      );
      const invitations = await pool.query(
        'SELECT id, revoked_at FROM ridr.invitations WHERE ride_id = $1',
        [created.ride.id],
      );
      assert.deepEqual(invitations.rows, [{ id: created.invite.id, revoked_at: null }]);
      const invitationReceipts = await pool.query(
        'SELECT 1 FROM ridr.command_receipts WHERE actor_id = $1 AND command_id = ANY($2::uuid[])',
        [leader.id, [rotateKey, revokeKey]],
      );
      assert.equal(invitationReceipts.rowCount, 0);
      await pool.query("UPDATE ridr.profiles SET account_state = 'deleting' WHERE id = $1", [
        leader.id,
      ]);
      await assert.rejects(
        rides.create(leader, { name: 'Blocked', transport: 'car', idempotencyKey: randomUUID() }),
        rejectsCode('ACCOUNT_UNAVAILABLE', 403),
      );
      await assert.rejects(
        rides.read(leader, created.ride.id),
        rejectsCode('ACCOUNT_UNAVAILABLE', 403),
      );
    },
  );

  await t.test('a 50th/51st join race counts pillions and admits exactly one person', async () => {
    const leader = account();
    const created = await create(leader);
    const seeded = Array.from({ length: 48 }, () => account());
    await pool.query(
      "INSERT INTO ridr.profiles (id, display_name) SELECT id, 'Capacity fixture' FROM unnest($1::uuid[]) AS id",
      [seeded.map((actor) => actor.id)],
    );
    await pool.query(
      `INSERT INTO ridr.memberships (id, ride_id, user_id, physical_role)
       SELECT member_id, $1, user_id, 'pillion' FROM unnest($2::uuid[], $3::uuid[]) AS fixture(member_id, user_id)`,
      [created.ride.id, seeded.map(() => randomUUID()), seeded.map((actor) => actor.id)],
    );
    const first = account();
    const second = account();
    const race = await Promise.allSettled([
      rides.join(first, created.ride.id, joinChange(created)),
      rides.join(second, created.ride.id, joinChange(created, { physicalRole: 'pillion' })),
    ]);
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = race.find((result) => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && rejectsCode('RIDE_FULL', 409)(rejected.reason));
    assert.equal((await rides.read(leader, created.ride.id)).members.length, 50);
    const winner = race[0]!.status === 'fulfilled' ? first : second;
    assert.equal(
      (await rides.join(winner, created.ride.id, joinChange(created))).membership.profileId,
      winner.id,
    );
  });

  await t.test(
    'two active ride joins serialize on the account claim while lobby membership remains allowed',
    async () => {
      const firstLeader = account();
      const secondLeader = account();
      const guest = account();
      const first = await create(firstLeader);
      const second = await create(secondLeader);
      await startFixture(first.ride.id);
      await startFixture(second.ride.id);
      assert.equal((await rides.preview(guest, { code: first.invite.code! })).state, 'active');
      const race = await Promise.allSettled([
        rides.join(guest, first.ride.id, joinChange(first)),
        rides.join(guest, second.ride.id, joinChange(second)),
      ]);
      assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = race.find((result) => result.status === 'rejected');
      assert.ok(
        rejected?.status === 'rejected' &&
          rejectsCode('ACTIVE_RIDE_CONFLICT', 409)(rejected.reason),
      );
      const claims = await pool.query('SELECT 1 FROM ridr.active_memberships WHERE user_id = $1', [
        guest.id,
      ]);
      assert.equal(claims.rowCount, 1);
      const memberships = await pool.query('SELECT 1 FROM ridr.memberships WHERE user_id = $1', [
        guest.id,
      ]);
      assert.equal(memberships.rowCount, 1);
      const lobby = await create(firstLeader);
      await rides.join(guest, lobby.ride.id, joinChange(lobby));
      assert.equal((await rides.list(guest, { limit: 50 })).items.length, 2);
      await assert.rejects(
        rides.rotate(firstLeader, first.ride.id, { revision: 1, idempotencyKey: randomUUID() }),
        rejectsCode('MOTION_RESTRICTED', 409),
      );
    },
  );

  await t.test(
    'rotation authorizes the current leader, checks revision, redacts replay and revokes previous credentials',
    async () => {
      const leader = account();
      const member = account();
      const outsider = account();
      const created = await create(leader);
      await rides.join(member, created.ride.id, joinChange(created));
      const change = { revision: 2, idempotencyKey: randomUUID() };
      await assert.rejects(
        rides.rotate(member, created.ride.id, change),
        rejectsCode('FORBIDDEN', 403),
      );
      await assert.rejects(
        rides.rotate(outsider, created.ride.id, change),
        rejectsCode('NOT_FOUND', 404),
      );
      await assert.rejects(
        rides.rotate(leader, created.ride.id, { ...change, revision: 1 }),
        rejectsCode('REVISION_CONFLICT', 412),
      );
      const rotated = await rides.rotate(leader, created.ride.id, change);
      assert.equal(rotated.tokenAvailable, true);
      assert.equal((await rides.read(leader, created.ride.id)).ride.revision, 3);
      await assert.rejects(
        rides.preview(outsider, { code: created.invite.code! }),
        rejectsCode('INVITE_UNAVAILABLE'),
      );
      assert.equal(
        (await rides.preview(outsider, { code: rotated.code! })).rideId,
        created.ride.id,
      );
      assert.deepEqual(await rides.rotate(leader, created.ride.id, change), {
        id: rotated.id,
        expiresAt: rotated.expiresAt,
        tokenAvailable: false,
      });
      const receipt = await pool.query(
        'SELECT result FROM ridr.command_receipts WHERE actor_id = $1 AND command_id = $2',
        [leader.id, change.idempotencyKey],
      );
      assert.ok(!JSON.stringify(receipt.rows).includes(rotated.code!));
      assert.ok(
        !JSON.stringify(receipt.rows).includes(new URL(rotated.url!).searchParams.get('token')!),
      );
      await assert.rejects(
        rides.revoke(member, created.ride.id, { idempotencyKey: randomUUID() }),
        rejectsCode('FORBIDDEN'),
      );
      const revokeKey = randomUUID();
      await rides.revoke(leader, created.ride.id, { idempotencyKey: revokeKey });
      await rides.revoke(leader, created.ride.id, { idempotencyKey: revokeKey });
      await rides.revoke(leader, created.ride.id, { idempotencyKey: randomUUID() });
      assert.equal((await rides.read(leader, created.ride.id)).ride.revision, 4);
      await assert.rejects(
        rides.preview(outsider, { code: rotated.code! }),
        rejectsCode('INVITE_UNAVAILABLE'),
      );
      await pool.query('UPDATE ridr.memberships SET left_at = clock_timestamp() WHERE id = $1', [
        created.membership.id,
      ]);
      await assert.rejects(rides.rotate(leader, created.ride.id, change), rejectsCode('NOT_FOUND'));
      await assert.rejects(
        rides.revoke(leader, created.ride.id, { idempotencyKey: revokeKey }),
        rejectsCode('NOT_FOUND'),
      );
    },
  );

  await t.test(
    'own ride pagination is stable at equal timestamps and cursors cannot be used by another account',
    async () => {
      const leader = account();
      const outsider = account();
      const created = await Promise.all([create(leader), create(leader), create(leader)]);
      const rideIds = created.map((result) => result.ride.id);
      await pool.query('UPDATE ridr.rides SET created_at = $2 WHERE id = ANY($1::uuid[])', [
        rideIds,
        '2026-01-01T00:00:00.123456Z',
      ]);
      const pageOne = await rides.list(leader, { limit: 2 });
      assert.equal(pageOne.items.length, 2);
      assert.ok(pageOne.nextCursor);
      const pageTwo = await rides.list(leader, { limit: 2, cursor: pageOne.nextCursor });
      assert.equal(pageTwo.items.length, 1);
      assert.equal(pageTwo.nextCursor, null);
      assert.deepEqual(
        [...pageOne.items, ...pageTwo.items].map((item) => item.ride.id),
        rideIds.sort().reverse(),
      );
      await assert.rejects(
        rides.list(outsider, { limit: 2, cursor: pageOne.nextCursor }),
        rejectsCode('INVALID_REQUEST', 400),
      );
      await assert.rejects(
        rides.list(leader, { limit: 2, cursor: 'malformed' }),
        rejectsCode('INVALID_REQUEST', 400),
      );
      for (const createdAt of ['2026-02-31T00:00:00.123456Z', '0000-01-01T00:00:00.123456Z']) {
        const cursor = Buffer.from(
          JSON.stringify({
            ...JSON.parse(Buffer.from(pageOne.nextCursor, 'base64url').toString('utf8')),
            createdAt,
          }),
        ).toString('base64url');
        await assert.rejects(
          rides.list(leader, { limit: 2, cursor }),
          rejectsCode('INVALID_REQUEST', 400),
        );
      }
    },
  );
});
