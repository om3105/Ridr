import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { ApiError, unauthenticated } from '../src/api-errors.js';
import type { TokenVerifier, VerifiedAccount } from '../src/auth.js';
import { OperationalLogger } from '../src/logging.js';
import { PostgresRides } from '../src/ride-store.js';
import type {
  CreatedRide,
  Membership,
  MotionContext,
  PhysicalRole,
  StartRide,
} from '../src/ride-types.js';

const rejectsCode = (code: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code;
const motion = (): MotionContext => {
  const capturedAt = new Date().toISOString();
  return { capturedAt, motion: { state: 'stopped', source: 'speed', observedAt: capturedAt } };
};
const command = () => ({ idempotencyKey: randomUUID() });
const stop = (consentEpoch = 0) => ({
  ...command(),
  consentEpoch,
  stoppedAt: new Date().toISOString(),
});

// Only random fixtures created by this test are removed; no provider or email requests are made.
test('PostgreSQL ride management preserves lifecycle, consent and concurrent authority', async (t) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(process.env.DATABASE_URL);
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname),
    'Management integration tests require a local database.',
  );
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const actorIds: string[] = [];
  const rideIds: string[] = [];
  const revoked = new Set<string>();
  const verifier: TokenVerifier = {
    verify: async () => {
      throw new Error('These tests provide verified fixture accounts.');
    },
    assertActive: async (actor) => {
      if (revoked.has(actor.sessionId)) throw unauthenticated();
    },
    close: async () => undefined,
  };
  const rides = new PostgresRides(databaseUrl, verifier, new OperationalLogger(() => undefined));
  const account = (): VerifiedAccount => {
    const result = {
      id: randomUUID(),
      sessionId: randomUUID(),
      initialDisplayName: 'Management fixture',
      expiresAt: Date.now() / 1000 + 600,
    };
    actorIds.push(result.id);
    return result;
  };
  const create = async (leader: VerifiedAccount) => {
    const result = await rides.create(leader, {
      ...command(),
      name: 'Day 7 fixture',
      transport: 'motorcycle',
    });
    rideIds.push(result.ride.id);
    return result;
  };
  const join = (
    actor: VerifiedAccount,
    created: CreatedRide,
    physicalRole: PhysicalRole = 'rider',
  ) =>
    rides.join(actor, created.ride.id, {
      ...command(),
      inviteCode: created.invite.code!,
      physicalRole,
    });
  const startChange = async (leader: VerifiedAccount, id: string): Promise<StartRide> => ({
    ...command(),
    ...motion(),
    revision: (await rides.management(leader, id)).ride.revision,
  });
  const proposal = async (
    leader: VerifiedAccount,
    id: string,
    targetMemberId: string,
    physicalRole?: PhysicalRole,
  ) =>
    rides.propose(leader, id, physicalRole ? 'role_change' : 'leadership', {
      ...(await startChange(leader, id)),
      targetMemberId,
      ...(physicalRole ? { physicalRole } : {}),
    });
  const count = async (sql: string, values: unknown[]) =>
    Number((await pool.query<{ count: string }>(sql, values)).rows[0]!.count);

  // Seed later-milestone pairing records to exercise Day 7's cross-feature invariants.
  const pairFixture = async (
    created: CreatedRide,
    rider: Membership,
    pillion: Membership,
    ready = true,
  ) => {
    const pairId = randomUUID();
    const requestId = randomUUID();
    const challengeId = randomUUID();
    const receiptId = randomUUID();
    const roundId = randomUUID();
    const headcountChallenge = randomUUID();
    const headcountReceipt = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ridr.consent_requests (id, ride_id, requester_member_id, target_member_id, kind, challenge_hash, expires_at, accepted_at)
        VALUES ($1,$2,$3,$4,'pair',$5,now() + interval '5 minutes',now())`,
        [requestId, created.ride.id, rider.id, pillion.id, randomBytes(32)],
      );
      await client.query(
        'INSERT INTO ridr.pairs (id,ride_id,rider_member_id,pillion_member_id,consent_request_id) VALUES ($1,$2,$3,$4,$5)',
        [pairId, created.ride.id, rider.id, pillion.id, requestId],
      );
      await client.query(
        'INSERT INTO ridr.active_pair_members (membership_id,pair_id,ride_id) VALUES ($1,$3,$4),($2,$3,$4)',
        [rider.id, pillion.id, pairId, created.ride.id],
      );
      await client.query(
        'UPDATE ridr.rides SET pairing_revision = pairing_revision + 1 WHERE id = $1',
        [created.ride.id],
      );
      if (ready) {
        await client.query(
          `INSERT INTO ridr.scan_challenges (id,ride_id,pair_id,issued_by_member_id,token_hash,expires_at,consumed_at)
          VALUES ($1,$2,$3,$4,$5,now() + interval '5 minutes',now())`,
          [challengeId, created.ride.id, pairId, rider.id, randomBytes(32)],
        );
        await client.query(
          'INSERT INTO ridr.scan_receipts (id,challenge_id,ride_id,scanned_by_member_id,accepted_at) VALUES ($1,$2,$3,$4,now())',
          [receiptId, challengeId, created.ride.id, pillion.id],
        );
        await client.query(
          'INSERT INTO ridr.readiness (pair_id,attesting_member_id,helmet_attested,ready_attested,confirmed_at,scan_receipt_id) VALUES ($1,$2,true,true,now(),$3)',
          [pairId, pillion.id, receiptId],
        );
        await client.query(
          `INSERT INTO ridr.headcount_rounds (id,ride_id,leader_member_id,pairing_revision)
          SELECT $1,id,leader_member_id,pairing_revision FROM ridr.rides WHERE id=$2`,
          [roundId, created.ride.id],
        );
        await client.query(
          `INSERT INTO ridr.scan_challenges (id,ride_id,pair_id,round_id,issued_by_member_id,token_hash,expires_at,consumed_at)
          VALUES ($1,$2,$3,$4,$5,$6,now() + interval '5 minutes',now())`,
          [headcountChallenge, created.ride.id, pairId, roundId, pillion.id, randomBytes(32)],
        );
        await client.query(
          'INSERT INTO ridr.scan_receipts (id,challenge_id,ride_id,scanned_by_member_id,accepted_at) VALUES ($1,$2,$3,$4,now())',
          [headcountReceipt, headcountChallenge, created.ride.id, created.membership.id],
        );
        await client.query(
          'INSERT INTO ridr.headcount_confirmations (ride_id,round_id,pair_id,scanned_by_member_id,confirmed_at,scan_receipt_id) VALUES ($1,$2,$3,$4,now(),$5)',
          [created.ride.id, roundId, pairId, created.membership.id, headcountReceipt],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { pairId, roundId, challengeId, receiptId };
  };
  const sharingFixture = async (member: Membership, epoch = 1, speed = 0) => {
    const deviceId = randomUUID();
    const sampleId = randomUUID();
    await pool.query("INSERT INTO ridr.devices (id,user_id,platform) VALUES ($1,$2,'ios')", [
      deviceId,
      member.profileId,
    ]);
    await pool.query(
      'INSERT INTO ridr.sharing_periods (membership_id,epoch,started_at) VALUES ($1,$2,clock_timestamp())',
      [member.id, epoch],
    );
    await pool.query(
      'UPDATE ridr.memberships SET sharing=true,consent_epoch=$2,revision=revision+1 WHERE id=$1',
      [member.id, epoch],
    );
    await pool.query(
      `INSERT INTO ridr.location_samples (id,membership_id,user_id,ride_id,device_id,consent_epoch,captured_at,lat,lon,accuracy_m,speed_mps)
      VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp(),18,73,10,$7)`,
      [sampleId, member.id, member.profileId, member.rideId, deviceId, epoch, speed],
    );
    await pool.query(
      'INSERT INTO ridr.location_latest (membership_id,sample_id) VALUES ($1,$2) ON CONFLICT (membership_id) DO UPDATE SET sample_id=EXCLUDED.sample_id',
      [member.id, sampleId],
    );
    await pool.query(
      `INSERT INTO ridr.status_links (id,ride_id,owner_member_id,token_hash,expires_at)
      VALUES ($1,$2,$3,$4,now() + interval '4 hours')`,
      [randomUUID(), member.rideId, member.id, randomBytes(32)],
    );
  };
  t.after(async () => {
    await rides.close();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM ridr.command_receipts WHERE actor_id = ANY($1::uuid[])', [
        actorIds,
      ]);
      for (const table of [
        'outbox_events',
        'status_links',
        'active_memberships',
        'headcount_confirmations',
        'readiness',
        'scan_receipts',
        'scan_challenges',
        'active_pair_members',
        'pairs',
        'headcount_rounds',
        'consent_requests',
        'invitations',
      ]) {
        const predicate =
          table === 'readiness'
            ? 'pair_id IN (SELECT id FROM ridr.pairs WHERE ride_id = ANY($1::uuid[]))'
            : 'ride_id = ANY($1::uuid[])';
        await client.query(`DELETE FROM ridr.${table} WHERE ${predicate}`, [rideIds]);
      }
      await client.query(
        'DELETE FROM ridr.location_latest WHERE membership_id IN (SELECT id FROM ridr.memberships WHERE ride_id=ANY($1::uuid[]))',
        [rideIds],
      );
      await client.query('DELETE FROM ridr.location_samples WHERE ride_id=ANY($1::uuid[])', [
        rideIds,
      ]);
      await client.query(
        'DELETE FROM ridr.sharing_periods WHERE membership_id IN (SELECT id FROM ridr.memberships WHERE ride_id=ANY($1::uuid[]))',
        [rideIds],
      );
      await client.query('DELETE FROM ridr.devices WHERE user_id=ANY($1::uuid[])', [actorIds]);
      await client.query('DELETE FROM ridr.routes WHERE ride_id=ANY($1::uuid[])', [rideIds]);
      await client.query('DELETE FROM ridr.memberships WHERE ride_id=ANY($1::uuid[])', [rideIds]);
      await client.query('DELETE FROM ridr.rides WHERE id=ANY($1::uuid[])', [rideIds]);
      await client.query('DELETE FROM ridr.profiles WHERE id=ANY($1::uuid[])', [actorIds]);
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
    'start and end are atomic, preserve exact retries and close all live access',
    async () => {
      const leader = account();
      const guest = account();
      const created = await create(leader);
      const joined = await join(guest, created);
      const startRequest = await startChange(leader, created.ride.id);
      await assert.rejects(
        rides.start(guest, created.ride.id, startRequest),
        rejectsCode('FORBIDDEN'),
      );
      const started = await rides.start(leader, created.ride.id, startRequest);
      assert.equal(started.state, 'active');
      assert.ok(started.startedAt);
      assert.deepEqual(await rides.start(leader, created.ride.id, startRequest), started);
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_memberships WHERE ride_id=$1', [
          created.ride.id,
        ]),
        2,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.memberships WHERE ride_id=$1 AND sharing', [
          created.ride.id,
        ]),
        0,
      );
      await sharingFixture(joined.membership);
      const request = {
        ...command(),
        reason: 'completed' as const,
        capturedAt: new Date().toISOString(),
        consentEpoch: 0,
      };
      const ended = await rides.end(leader, created.ride.id, request);
      assert.equal(ended.state, 'ended');
      assert.deepEqual(await rides.end(leader, created.ride.id, request), ended);
      assert.deepEqual(
        await rides.end(leader, created.ride.id, { ...request, ...command() }),
        ended,
      );
      await assert.rejects(
        rides.start(leader, created.ride.id, startRequest),
        rejectsCode('NOT_FOUND'),
      );
      await assert.rejects(rides.read(guest, created.ride.id), rejectsCode('NOT_FOUND'));
      for (const table of ['active_memberships', 'location_latest']) {
        const predicate =
          table === 'location_latest'
            ? 'membership_id IN (SELECT id FROM ridr.memberships WHERE ride_id=$1)'
            : 'ride_id=$1';
        assert.equal(
          await count(`SELECT count(*) FROM ridr.${table} WHERE ${predicate}`, [created.ride.id]),
          0,
        );
      }
      for (const table of ['invitations', 'status_links'])
        assert.equal(
          await count(
            `SELECT count(*) FROM ridr.${table} WHERE ride_id=$1 AND revoked_at IS NULL`,
            [created.ride.id],
          ),
          0,
        );
      assert.equal(
        await count(
          "SELECT count(*) FROM ridr.outbox_events WHERE ride_id=$1 AND kind='ride.ended'",
          [created.ride.id],
        ),
        1,
      );
      assert.equal(
        await count(
          'SELECT count(*) FROM ridr.sharing_periods WHERE membership_id=$1 AND stopped_at IS NULL',
          [joined.membership.id],
        ),
        0,
      );
      const management = await rides.management(guest, created.ride.id);
      assert.equal(management.ride.state, 'ended');
      assert.deepEqual(Object.keys(management).sort(), ['membership', 'proposals', 'ride']);
      assert.deepEqual(management.proposals, []);
      await assert.rejects(rides.management(account(), created.ride.id), rejectsCode('NOT_FOUND'));
    },
  );

  await t.test('motion, state and readiness failures leave no partial active claims', async () => {
    const leader = account();
    const guest = account();
    const created = await create(leader);
    const joined = await join(guest, created, 'pillion');
    const pair = await pairFixture(created, created.membership, joined.membership, false);
    const request = await startChange(leader, created.ride.id);
    for (const context of [
      { ...motion(), motion: { ...request.motion, state: 'moving' as const } },
      { ...motion(), motion: { ...request.motion, source: 'unavailable' as const } },
      {
        ...motion(),
        motion: { ...request.motion, observedAt: new Date(Date.now() - 60000).toISOString() },
      },
      { capturedAt: new Date(Date.now() + 60000).toISOString(), motion: request.motion },
    ])
      await assert.rejects(
        rides.start(leader, created.ride.id, { ...request, ...context }),
        rejectsCode('MOTION_RESTRICTED'),
      );
    await assert.rejects(
      rides.start(leader, created.ride.id, {
        ...request,
        motion: { ...request.motion, state: 'unknown' },
      }),
      rejectsCode('MOTION_RESTRICTED'),
    );
    await assert.rejects(
      rides.start(leader, created.ride.id, request),
      (error: unknown) =>
        rejectsCode('PAIR_NOT_READY')(error) && (error as ApiError).fields?.pairIds === pair.pairId,
    );
    assert.equal(
      await count('SELECT count(*) FROM ridr.active_memberships WHERE ride_id=$1', [
        created.ride.id,
      ]),
      0,
    );
    assert.equal(
      await count('SELECT count(*) FROM ridr.command_receipts WHERE command_id=$1', [
        request.idempotencyKey,
      ]),
      0,
    );
    await assert.rejects(
      rides.end(leader, created.ride.id, {
        ...command(),
        reason: 'completed',
        capturedAt: new Date().toISOString(),
        consentEpoch: 0,
      }),
      rejectsCode('STATE_CONFLICT'),
    );
    const ended = await rides.end(leader, created.ride.id, {
      ...command(),
      reason: 'cancelled',
      capturedAt: new Date().toISOString(),
      consentEpoch: 0,
    });
    assert.equal(ended.startedAt, null);
    assert.equal(
      await count('SELECT count(*) FROM ridr.pairs WHERE id=$1 AND ended_at IS NOT NULL', [
        pair.pairId,
      ]),
      1,
    );
    assert.equal(
      await count('SELECT count(*) FROM ridr.active_pair_members WHERE pair_id=$1', [pair.pairId]),
      0,
    );
  });

  await t.test(
    'active invitation replacement requires fresh motion and respects contrary telemetry',
    async () => {
      const leader = account();
      const created = await create(leader);
      await rides.start(leader, created.ride.id, await startChange(leader, created.ride.id));
      const change = await startChange(leader, created.ride.id);
      const invite = await rides.rotate(leader, created.ride.id, change);
      assert.equal(invite.tokenAvailable, true);
      await assert.rejects(
        rides.preview(leader, { code: created.invite.code! }),
        rejectsCode('INVITE_UNAVAILABLE'),
      );
      await sharingFixture(created.membership, 1, 4);
      await assert.rejects(
        rides.rotate(leader, created.ride.id, await startChange(leader, created.ride.id)),
        rejectsCode('MOTION_RESTRICTED'),
      );
      assert.equal((await rides.preview(leader, { code: invite.code! })).rideId, created.ride.id);
      // Motion restrictions never prevent a privacy action.
      assert.equal((await rides.stopSharing(leader, created.ride.id, stop(1))).enabled, false);
      assert.equal(
        (
          await rides.end(leader, created.ride.id, {
            ...command(),
            reason: 'completed',
            capturedAt: new Date().toISOString(),
            consentEpoch: 2,
          })
        ).state,
        'ended',
      );
    },
  );

  await t.test(
    'leadership needs named Rider acceptance, revokes former authority and preserves pairing',
    async () => {
      const leader = account();
      const next = account();
      const passenger = account();
      const created = await create(leader);
      const candidate = await join(next, created);
      const pillion = await join(passenger, created, 'pillion');
      const pair = await pairFixture(created, candidate.membership, pillion.membership);
      await assert.rejects(
        proposal(leader, created.ride.id, pillion.membership.id),
        rejectsCode('PROPOSAL_INVALID'),
      );
      const proposed = await proposal(leader, created.ride.id, candidate.membership.id);
      assert.equal(
        (await rides.management(next, created.ride.id)).proposals[0]!.id,
        proposed.proposalId,
      );
      assert.deepEqual((await rides.management(passenger, created.ride.id)).proposals, []);
      const acceptance = { ...command(), ...motion() };
      await assert.rejects(
        rides.accept(leader, created.ride.id, proposed.proposalId, 'leadership', acceptance),
        rejectsCode('FORBIDDEN'),
      );
      const accepted = await rides.accept(
        next,
        created.ride.id,
        proposed.proposalId,
        'leadership',
        acceptance,
      );
      assert.ok('leaderMemberId' in accepted);
      assert.equal(accepted.leaderMemberId, candidate.membership.id);
      assert.deepEqual(
        await rides.accept(next, created.ride.id, proposed.proposalId, 'leadership', acceptance),
        accepted,
      );
      const members = (await rides.read(next, created.ride.id)).members;
      assert.equal(members.filter((member) => member.role === 'leader').length, 1);
      assert.equal(members.find((member) => member.profileId === leader.id)!.role, 'rider');
      await assert.rejects(
        rides.end(leader, created.ride.id, {
          ...command(),
          reason: 'cancelled',
          capturedAt: new Date().toISOString(),
          consentEpoch: 0,
        }),
        rejectsCode('FORBIDDEN'),
      );
      await assert.rejects(
        rides.revoke(leader, created.ride.id, command()),
        rejectsCode('FORBIDDEN'),
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.pairs WHERE id=$1 AND ended_at IS NULL', [
          pair.pairId,
        ]),
        1,
      );
      assert.equal(
        await count(
          'SELECT count(*) FROM ridr.readiness WHERE pair_id=$1 AND invalidated_at IS NULL',
          [pair.pairId],
        ),
        1,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_pair_members WHERE pair_id=$1', [
          pair.pairId,
        ]),
        2,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.headcount_confirmations WHERE round_id=$1', [
          pair.roundId,
        ]),
        0,
      );
      assert.equal(
        (await rides.start(next, created.ride.id, await startChange(next, created.ride.id))).state,
        'active',
      );
    },
  );

  await t.test(
    'expired, changed, canceled and cross-ride proposals cannot transfer authority',
    async () => {
      const leader = account();
      const target = account();
      const stranger = account();
      const created = await create(leader);
      const joined = await join(target, created);
      await join(stranger, created);
      const expired = await proposal(leader, created.ride.id, joined.membership.id);
      await pool.query(
        "UPDATE ridr.consent_requests SET created_at=now()-interval '6 minutes', expires_at=now()-interval '1 minute' WHERE id=$1",
        [expired.proposalId],
      );
      await assert.rejects(
        rides.accept(target, created.ride.id, expired.proposalId, 'leadership', {
          ...command(),
          ...motion(),
        }),
        rejectsCode('PROPOSAL_STALE'),
      );
      const changed = await proposal(leader, created.ride.id, joined.membership.id);
      await rides.stopSharing(target, created.ride.id, stop());
      await assert.rejects(
        rides.accept(target, created.ride.id, changed.proposalId, 'leadership', {
          ...command(),
          ...motion(),
        }),
        rejectsCode('PROPOSAL_STALE'),
      );
      const canceled = await proposal(leader, created.ride.id, joined.membership.id);
      await assert.rejects(
        rides.cancel(stranger, created.ride.id, canceled.proposalId, 'leadership', command()),
        rejectsCode('FORBIDDEN'),
      );
      const cancelRequest = command();
      await rides.cancel(target, created.ride.id, canceled.proposalId, 'leadership', cancelRequest);
      await rides.cancel(target, created.ride.id, canceled.proposalId, 'leadership', cancelRequest);
      await assert.rejects(
        rides.accept(target, created.ride.id, canceled.proposalId, 'leadership', {
          ...command(),
          ...motion(),
        }),
        rejectsCode('PROPOSAL_STALE'),
      );
      const other = await create(leader);
      await join(target, other);
      await assert.rejects(
        rides.accept(target, other.ride.id, canceled.proposalId, 'leadership', {
          ...command(),
          ...motion(),
        }),
        rejectsCode('NOT_FOUND'),
      );
      assert.equal(
        (await rides.management(leader, created.ride.id)).ride.leaderMemberId,
        created.membership.id,
      );
      assert.equal(
        await count(
          "SELECT count(*) FROM ridr.outbox_events WHERE ride_id=$1 AND kind='ride.leader_changed'",
          [created.ride.id],
        ),
        0,
      );
    },
  );

  await t.test(
    'accepted role changes clear affected pairs, readiness and headcount without changing sharing',
    async () => {
      const leader = account();
      const rider = account();
      const passenger = account();
      const created = await create(leader);
      const joined = await join(rider, created);
      const pillion = await join(passenger, created, 'pillion');
      const pair = await pairFixture(created, joined.membership, pillion.membership);
      await rides.start(leader, created.ride.id, await startChange(leader, created.ride.id));
      await sharingFixture(pillion.membership);
      const proposed = await proposal(leader, created.ride.id, pillion.membership.id, 'rider');
      const accepted = await rides.accept(
        passenger,
        created.ride.id,
        proposed.proposalId,
        'role_change',
        { ...command(), ...motion() },
      );
      assert.ok('physicalRole' in accepted);
      assert.equal(accepted.physicalRole, 'rider');
      assert.equal(accepted.sharingEnabled, true);
      assert.equal(
        await count('SELECT count(*) FROM ridr.pairs WHERE id=$1 AND ended_at IS NOT NULL', [
          pair.pairId,
        ]),
        1,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_pair_members WHERE pair_id=$1', [
          pair.pairId,
        ]),
        0,
      );
      assert.equal(
        await count(
          'SELECT count(*) FROM ridr.readiness WHERE pair_id=$1 AND invalidated_at IS NOT NULL',
          [pair.pairId],
        ),
        1,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.headcount_confirmations WHERE pair_id=$1', [
          pair.pairId,
        ]),
        0,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_memberships WHERE ride_id=$1', [
          created.ride.id,
        ]),
        3,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.location_latest WHERE membership_id=$1', [
          pillion.membership.id,
        ]),
        1,
      );
    },
  );

  await t.test(
    'stop sharing retains membership and pairing; stale epochs cannot cancel a new opt-in',
    async () => {
      const leader = account();
      const passenger = account();
      const created = await create(leader);
      const joined = await join(passenger, created, 'pillion');
      const pair = await pairFixture(created, created.membership, joined.membership);
      await rides.start(leader, created.ride.id, await startChange(leader, created.ride.id));
      await sharingFixture(joined.membership);
      // Use the database clock so Docker/host skew does not invoke the future-time cap.
      const captured = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      const request = { ...stop(1), stoppedAt: captured.rows[0]!.now.toISOString() };
      const stopped = await rides.stopSharing(passenger, created.ride.id, request);
      assert.equal(stopped.enabled, false);
      assert.deepEqual(await rides.stopSharing(passenger, created.ride.id, request), stopped);
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_memberships WHERE membership_id=$1', [
          joined.membership.id,
        ]),
        1,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_pair_members WHERE pair_id=$1', [
          pair.pairId,
        ]),
        2,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.location_latest WHERE membership_id=$1', [
          joined.membership.id,
        ]),
        0,
      );
      const period = await pool.query<{ stopped_at: Date }>(
        'SELECT stopped_at FROM ridr.sharing_periods WHERE membership_id=$1 AND epoch=1',
        [joined.membership.id],
      );
      assert.equal(period.rows[0]!.stopped_at.toISOString(), request.stoppedAt);
      await sharingFixture(joined.membership, stopped.consentEpoch + 1);
      const stale = await rides.stopSharing(passenger, created.ride.id, stop(1));
      assert.equal(stale.enabled, true);
      assert.equal(stale.consentEpoch, stopped.consentEpoch + 1);
      assert.equal(
        await count('SELECT count(*) FROM ridr.location_latest WHERE membership_id=$1', [
          joined.membership.id,
        ]),
        1,
      );
      assert.equal(
        await count(
          'SELECT count(*) FROM ridr.status_links WHERE owner_member_id=$1 AND revoked_at IS NULL',
          [joined.membership.id],
        ),
        1,
      );
      await assert.rejects(
        rides.leave(leader, created.ride.id, stop()),
        rejectsCode('LEADER_MUST_TRANSFER_OR_END'),
      );
      await rides.stopSharing(leader, created.ride.id, stop());
      assert.equal((await rides.read(passenger, created.ride.id)).members.length, 2);
    },
  );

  await t.test(
    'leave removes pair and live claims while retaining only own reconciliation and exact privacy retries',
    async () => {
      const leader = account();
      const passenger = account();
      const created = await create(leader);
      const joined = await join(passenger, created, 'pillion');
      const pair = await pairFixture(created, created.membership, joined.membership);
      await rides.start(leader, created.ride.id, await startChange(leader, created.ride.id));
      await sharingFixture(joined.membership);
      const request = stop(1);
      const left = await rides.leave(passenger, created.ride.id, request);
      assert.deepEqual(await rides.leave(passenger, created.ride.id, request), left);
      await assert.rejects(rides.read(passenger, created.ride.id), rejectsCode('NOT_FOUND'));
      const own = await rides.management(passenger, created.ride.id);
      assert.equal(own.membership.leftAt, left.leftAt);
      assert.deepEqual(own.proposals, []);
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_memberships WHERE membership_id=$1', [
          joined.membership.id,
        ]),
        0,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_pair_members WHERE pair_id=$1', [
          pair.pairId,
        ]),
        0,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.location_latest WHERE membership_id=$1', [
          joined.membership.id,
        ]),
        0,
      );
      assert.equal(
        await count(
          'SELECT count(*) FROM ridr.status_links WHERE owner_member_id=$1 AND revoked_at IS NULL',
          [joined.membership.id],
        ),
        0,
      );
      assert.equal((await rides.stopSharing(passenger, created.ride.id, stop(1))).enabled, false);
      assert.equal((await rides.list(passenger, { limit: 50 })).items.length, 0);
    },
  );

  await t.test(
    'competing starts with a shared participant commit exactly one full set of claims',
    async () => {
      const leaders = [account(), account()];
      const shared = account();
      const first = await create(leaders[0]!);
      const second = await create(leaders[1]!);
      await join(shared, first);
      await join(shared, second);
      const requests = [
        await startChange(leaders[0]!, first.ride.id),
        await startChange(leaders[1]!, second.ride.id),
      ];
      const results = await Promise.allSettled([
        rides.start(leaders[0]!, first.ride.id, requests[0]!),
        rides.start(leaders[1]!, second.ride.id, requests[1]!),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(
        rejected?.status === 'rejected' && rejectsCode('ACTIVE_RIDE_CONFLICT')(rejected.reason),
      );
      const winner = results[0]!.status === 'fulfilled' ? first : second;
      const loser = winner === first ? second : first;
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_memberships WHERE ride_id=$1', [
          winner.ride.id,
        ]),
        2,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_memberships WHERE ride_id=$1', [
          loser.ride.id,
        ]),
        0,
      );
      assert.equal(
        await count("SELECT count(*) FROM ridr.rides WHERE id=$1 AND state='lobby'", [
          loser.ride.id,
        ]),
        1,
      );
      assert.equal(
        await count(
          "SELECT count(*) FROM ridr.outbox_events WHERE ride_id=ANY($1::uuid[]) AND kind='ride.started'",
          [[first.ride.id, second.ride.id]],
        ),
        1,
      );
    },
  );

  await t.test(
    'a start racing the 50th and 51st joins never exceeds capacity or misses an active claim',
    async () => {
      const leader = account();
      const created = await create(leader);
      const seeded = Array.from({ length: 48 }, account);
      await pool.query(
        "INSERT INTO ridr.profiles (id,display_name) SELECT id,'Capacity fixture' FROM unnest($1::uuid[]) id",
        [seeded.map((actor) => actor.id)],
      );
      await pool.query(
        "INSERT INTO ridr.memberships (id,ride_id,user_id,physical_role) SELECT member_id,$1,user_id,'rider' FROM unnest($2::uuid[],$3::uuid[]) fixture(member_id,user_id)",
        [created.ride.id, seeded.map(() => randomUUID()), seeded.map((actor) => actor.id)],
      );
      const request = await startChange(leader, created.ride.id);
      const contenders = [account(), account()];
      const [started, ...joins] = await Promise.allSettled([
        rides.start(leader, created.ride.id, request),
        join(contenders[0]!, created),
        join(contenders[1]!, created),
      ]);
      assert.equal(joins.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = joins.find((result) => result.status === 'rejected');
      assert.ok(rejected?.status === 'rejected' && rejectsCode('RIDE_FULL')(rejected.reason));
      if (started!.status === 'rejected') {
        assert.ok(rejectsCode('REVISION_CONFLICT')(started!.reason));
        await rides.start(leader, created.ride.id, await startChange(leader, created.ride.id));
      }
      assert.equal(
        await count('SELECT count(*) FROM ridr.memberships WHERE ride_id=$1 AND left_at IS NULL', [
          created.ride.id,
        ]),
        50,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_memberships WHERE ride_id=$1', [
          created.ride.id,
        ]),
        50,
      );
    },
  );

  await t.test('transfer racing end has one authority winner and cannot end twice', async () => {
    const leader = account();
    const next = account();
    const created = await create(leader);
    const joined = await join(next, created);
    const proposed = await proposal(leader, created.ride.id, joined.membership.id);
    const [accepted, ended] = await Promise.allSettled([
      rides.accept(next, created.ride.id, proposed.proposalId, 'leadership', {
        ...command(),
        ...motion(),
      }),
      rides.end(leader, created.ride.id, {
        ...command(),
        reason: 'cancelled',
        capturedAt: new Date().toISOString(),
        consentEpoch: 0,
      }),
    ]);
    assert.equal([accepted, ended].filter((result) => result.status === 'fulfilled').length, 1);
    if (accepted.status === 'fulfilled') {
      assert.ok(ended.status === 'rejected' && rejectsCode('FORBIDDEN')(ended.reason));
      await rides.end(next, created.ride.id, {
        ...command(),
        reason: 'cancelled',
        capturedAt: new Date().toISOString(),
        consentEpoch: 0,
      });
    } else assert.ok(rejectsCode('NOT_FOUND')(accepted.reason));
    assert.equal(
      await count(
        "SELECT count(*) FROM ridr.outbox_events WHERE ride_id=$1 AND kind='ride.ended'",
        [created.ride.id],
      ),
      1,
    );
    assert.equal((await rides.management(leader, created.ride.id)).ride.state, 'ended');
  });

  await t.test(
    'revoked sessions roll back lifecycle, proposal and privacy writes at commit',
    async () => {
      const leader = account();
      const target = account();
      const created = await create(leader);
      const joined = await join(target, created);
      const deniedLeader = { ...leader, sessionId: randomUUID() };
      revoked.add(deniedLeader.sessionId);
      const startRequest = await startChange(leader, created.ride.id);
      await assert.rejects(
        rides.start(deniedLeader, created.ride.id, startRequest),
        rejectsCode('UNAUTHENTICATED'),
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.active_memberships WHERE ride_id=$1', [
          created.ride.id,
        ]),
        0,
      );
      assert.equal((await rides.management(leader, created.ride.id)).ride.state, 'lobby');
      const proposed = await proposal(leader, created.ride.id, joined.membership.id);
      const deniedTarget = { ...target, sessionId: randomUUID() };
      revoked.add(deniedTarget.sessionId);
      const acceptance = { ...command(), ...motion() };
      await assert.rejects(
        rides.accept(deniedTarget, created.ride.id, proposed.proposalId, 'leadership', acceptance),
        rejectsCode('UNAUTHENTICATED'),
      );
      assert.equal(
        (await rides.management(leader, created.ride.id)).ride.leaderMemberId,
        created.membership.id,
      );
      assert.equal(
        await count(
          'SELECT count(*) FROM ridr.consent_requests WHERE id=$1 AND accepted_at IS NULL',
          [proposed.proposalId],
        ),
        1,
      );
      await sharingFixture(joined.membership);
      const stopRequest = stop(1);
      await assert.rejects(
        rides.stopSharing(deniedTarget, created.ride.id, stopRequest),
        rejectsCode('UNAUTHENTICATED'),
      );
      const endRequest = {
        ...command(),
        reason: 'cancelled' as const,
        capturedAt: new Date().toISOString(),
        consentEpoch: 0,
      };
      await assert.rejects(
        rides.end(deniedLeader, created.ride.id, endRequest),
        rejectsCode('UNAUTHENTICATED'),
      );
      assert.equal(
        await count(
          'SELECT count(*) FROM ridr.memberships WHERE id=$1 AND sharing AND consent_epoch=1',
          [joined.membership.id],
        ),
        1,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.location_latest WHERE membership_id=$1', [
          joined.membership.id,
        ]),
        1,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.command_receipts WHERE command_id=ANY($1::uuid[])', [
          [
            startRequest.idempotencyKey,
            acceptance.idempotencyKey,
            stopRequest.idempotencyKey,
            endRequest.idempotencyKey,
          ],
        ]),
        0,
      );
      assert.equal(
        await count('SELECT count(*) FROM ridr.outbox_events WHERE ride_id=$1', [created.ride.id]),
        0,
      );
    },
  );
  await t.test(
    'route saves enforce ownership, revisions, stopped state and preserve saved geometry',
    async () => {
      const leader = account(),
        member = account(),
        outsider = account();
      const created = await create(leader);
      const id = created.ride.id;
      await join(member, created);
      const points = [
        { lat: 18, lon: 73 },
        { lat: 19, lon: 74 },
      ];
      const change = { ...command(), ...motion(), source: 'gpx' as const, points, revision: 0 };
      assert.equal(await rides.route(member, id), null);
      const saved = await rides.saveRoute(leader, id, change);
      assert.equal(saved.revision, 1);
      assert.deepEqual(await rides.route(member, id), saved);
      assert.deepEqual(await rides.saveRoute(leader, id, change), saved);
      await assert.rejects(rides.route(outsider, id), rejectsCode('NOT_FOUND'));
      await assert.rejects(
        rides.saveRoute(member, id, { ...change, ...command(), revision: 1 }),
        rejectsCode('FORBIDDEN'),
      );
      await assert.rejects(
        rides.saveRoute(leader, id, { ...change, ...command() }),
        rejectsCode('REVISION_CONFLICT'),
      );
      await assert.rejects(
        rides.saveRoute(leader, id, {
          ...change,
          ...command(),
          revision: 1,
          motion: { ...change.motion, state: 'moving' },
        }),
        rejectsCode('MOTION_RESTRICTED'),
      );
      await assert.rejects(
        rides.saveRoute(leader, id, { ...change, ...command(), revision: 1, source: 'drawn' }),
        rejectsCode('ROUTING_UNAVAILABLE'),
      );
      assert.deepEqual(await rides.route(member, id), saved);
      const concurrent = await Promise.allSettled(
        [1, 2].map(() =>
          rides.saveRoute(leader, id, { ...change, ...command(), ...motion(), revision: 1 }),
        ),
      );
      assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
      await rides.start(leader, id, await startChange(leader, id));
      await assert.rejects(
        rides.saveRoute(leader, id, { ...change, ...command(), ...motion(), revision: 2 }),
        rejectsCode('RIDE_STATE_CONFLICT'),
      );
      assert.equal((await rides.route(member, id))!.revision, 2);
    },
  );
  await t.test(
    'ride start during a routing request prevents a late save without blocking start',
    async () => {
      const leader = account();
      const created = await create(leader);
      const id = created.ride.id;
      let finish!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const routed = new PostgresRides(
        databaseUrl,
        verifier,
        new OperationalLogger(() => undefined),
        async (points) => {
          entered();
          await pending;
          return points;
        },
      );
      try {
        const saving = routed.saveRoute(leader, id, {
          ...command(),
          ...motion(),
          source: 'drawn',
          revision: 0,
          points: [
            { lat: 18, lon: 73 },
            { lat: 19, lon: 74 },
          ],
        });
        const rejected = assert.rejects(saving, rejectsCode('RIDE_STATE_CONFLICT'));
        await started;
        await rides.start(leader, id, await startChange(leader, id));
        finish();
        await rejected;
        assert.equal(await rides.route(leader, id), null);
      } finally {
        finish();
        await routed.close();
      }
    },
  );
});
