import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { ApiError } from '../src/api-errors.js';
import { createApp } from '../src/app.js';
import type { AccountServices } from '../src/accounts.js';
import type { TokenVerifier, VerifiedAccount } from '../src/auth.js';
import { readConfig } from '../src/config.js';
import { OperationalLogger } from '../src/logging.js';
import { RideSummaryStore } from '../src/ride-summary.js';

test('ended summary is own-only, reflects late history and expires at 90 days', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname));
  const pool = new Pool({ connectionString: databaseUrl });
  const owner = randomUUID(),
    other = randomUUID(),
    outsider = randomUUID();
  const ride = randomUUID(),
    ownerMember = randomUUID(),
    otherMember = randomUUID();
  const device = randomUUID(),
    firstSample = randomUUID();
  const started = new Date(Date.now() - 3600000);
  const ended = new Date(Date.now() - 60000);
  const firstAt = new Date(started.getTime() + 10000);
  const logger = new OperationalLogger(() => undefined);
  const store = new RideSummaryStore(databaseUrl, logger);
  const account = (id: string): VerifiedAccount => ({
    id,
    sessionId: randomUUID(),
    initialDisplayName: 'Summary fixture',
    expiresAt: Date.now() / 1000 + 600,
  });
  const verifier: TokenVerifier = {
    verify: async (header) => account(header === 'Bearer owner' ? owner : outsider),
    assertActive: async () => undefined,
    close: async () => undefined,
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO ridr.profiles(id,display_name) VALUES ($1,$2),($3,$4)', [
      owner,
      'Summary owner',
      other,
      'Other member',
    ]);
    await client.query(
      `INSERT INTO ridr.rides(id,name,transport,state,leader_member_id,created_at,started_at,ended_at)
       VALUES ($1,'Finished fixture','cycling','ended',$2,$3::timestamptz - interval '1 minute',$3,$4)`,
      [ride, ownerMember, started, ended],
    );
    await client.query(
      `INSERT INTO ridr.memberships(id,ride_id,user_id,physical_role,joined_at,left_at)
       VALUES ($1,$3,$4,'rider',$6,NULL),($2,$3,$5,'rider',$6,$7)`,
      [
        ownerMember,
        otherMember,
        ride,
        owner,
        other,
        new Date(started.getTime() - 10000),
        new Date(ended.getTime() - 20000),
      ],
    );
    await client.query(
      `INSERT INTO ridr.sharing_periods(membership_id,epoch,started_at,stopped_at)
       VALUES ($1,1,$3,$4),($2,1,$3,$5)`,
      [ownerMember, otherMember, started, ended, new Date(ended.getTime() - 20000)],
    );
    await client.query("INSERT INTO ridr.devices(id,user_id,platform) VALUES ($1,$2,'android')", [
      device,
      owner,
    ]);
    await client.query(
      `INSERT INTO ridr.location_samples
       (id,membership_id,user_id,ride_id,device_id,consent_epoch,captured_at,received_at,lat,lon,accuracy_m)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,18.5,73,5)`,
      [firstSample, ownerMember, owner, ride, device, firstAt, ended],
    );
    await client.query('COMMIT');
    const initial = await store.read(account(owner), ride);
    assert.equal(initial.memberId, ownerMember);
    assert.equal(initial.recordedDistanceM, 0);
    assert.equal(initial.elapsedPaceMinPerKm, null);
    assert.equal(initial.participationDurationSeconds, 3540);
    assert.equal(
      initial.memberEvents.some((event) => event.memberId === otherMember && event.kind === 'left'),
      true,
    );
    assert.equal(
      initial.memberEvents.find((event) => event.memberId === otherMember)?.displayName,
      'Other member',
    );
    assert.ok(!JSON.stringify(initial.trace).includes('Other member'));
    assert.equal(
      (await store.read(account(owner), ride)).recordedDistanceM,
      initial.recordedDistanceM,
    );
    const otherSummary = await store.read(account(other), ride);
    assert.equal(otherSummary.memberId, otherMember);
    assert.equal(otherSummary.recordedDistanceM, 0);
    assert.equal(otherSummary.trace.shownPoints, 0);
    await assert.rejects(
      store.read(account(outsider), ride),
      (error: unknown) => error instanceof ApiError && error.code === 'NOT_FOUND',
    );
    const app = await createApp(readConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl }), {
      accounts: { verifier, profiles: { close: async () => undefined } } as AccountServices,
      logSink: () => undefined,
    });
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const response = await fetch(`${origin}/v1/history/${ride}`, {
        headers: { Authorization: 'Bearer owner' },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.json()).data.memberId, ownerMember);
      const forbidden = await fetch(`${origin}/v1/history/${ride}`, {
        headers: { Authorization: 'Bearer outsider' },
      });
      assert.equal(forbidden.status, 404);
    } finally {
      await app.close();
    }
    await pool.query(
      `INSERT INTO ridr.location_samples
       (id,membership_id,user_id,ride_id,device_id,consent_epoch,captured_at,received_at,lat,lon,accuracy_m)
       VALUES ($1,$2,$3,$4,$5,1,$6,clock_timestamp(),18.5,73.001,5)`,
      [randomUUID(), ownerMember, owner, ride, device, new Date(firstAt.getTime() + 10000)],
    );
    const refreshed = await store.read(account(owner), ride);
    assert.ok(refreshed.recordedDistanceM > 100);
    assert.ok(refreshed.updatedAt > initial.updatedAt);
    assert.equal(refreshed.trace.segments[0]?.length, 2);
    const departure = new Date(ended.getTime() - 600000);
    await pool.query('UPDATE ridr.memberships SET left_at=$2 WHERE id=$1', [
      ownerMember,
      departure,
    ]);
    await pool.query('UPDATE ridr.sharing_periods SET stopped_at=$2 WHERE membership_id=$1', [
      ownerMember,
      departure,
    ]);
    const departed = await store.read(account(owner), ride);
    assert.equal(departed.participationEndedAt, departure.toISOString());
    assert.ok(departed.memberEvents.every((event) => event.at <= departure.toISOString()));
    assert.ok(
      !departed.memberEvents.some(
        (event) => event.memberId === otherMember && event.kind === 'left',
      ),
    );
    await pool.query(
      `UPDATE ridr.rides SET created_at=$2::timestamptz - interval '1 minute',started_at=$2,ended_at=$3 WHERE id=$1`,
      [ride, new Date(Date.now() - 92 * 86400000), new Date(Date.now() - 91 * 86400000)],
    );
    await assert.rejects(
      store.read(account(owner), ride),
      (error: unknown) => error instanceof ApiError && error.code === 'NOT_FOUND',
    );
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('BEGIN');
    await client.query('DELETE FROM ridr.location_samples WHERE ride_id=$1', [ride]);
    await client.query('DELETE FROM ridr.sharing_periods WHERE membership_id IN ($1,$2)', [
      ownerMember,
      otherMember,
    ]);
    await client.query('DELETE FROM ridr.devices WHERE id=$1', [device]);
    await client.query('DELETE FROM ridr.memberships WHERE ride_id=$1', [ride]);
    await client.query('DELETE FROM ridr.rides WHERE id=$1', [ride]);
    await client.query('DELETE FROM ridr.profiles WHERE id IN ($1,$2)', [owner, other]);
    await client.query('COMMIT');
    client.release();
    await store.close();
    await pool.end();
  }
});
