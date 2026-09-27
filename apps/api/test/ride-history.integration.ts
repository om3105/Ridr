import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { ApiError } from '../src/api-errors.js';
import type { AccountServices } from '../src/accounts.js';
import { createApp } from '../src/app.js';
import type { TokenVerifier, VerifiedAccount } from '../src/auth.js';
import { readConfig } from '../src/config.js';
import { OperationalLogger } from '../src/logging.js';
import { RideSummaryStore } from '../src/ride-summary.js';

test('history pages only participated retained rides with account-bound cursors and fresh metrics', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname));
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const owner = randomUUID(), other = randomUUID(), device = randomUUID();
  const records = Array.from({ length: 4 }, () => ({ ride: randomUUID(), member: randomUUID() }));
  const now = Date.now();
  const ends = [1, 2, 91, 0.04].map((days) => new Date(now - days * 86400000));
  const starts = ends.map((end) => new Date(end.getTime() - 3600000));
  const account = (id: string): VerifiedAccount => ({
    id, sessionId: randomUUID(), initialDisplayName: 'History fixture', expiresAt: Date.now() / 1000 + 600,
  });
  const verifier: TokenVerifier = {
    verify: async (header) => account(header === 'Bearer owner' ? owner : other),
    assertActive: async () => undefined,
    close: async () => undefined,
  };
  const store = new RideSummaryStore(databaseUrl, new OperationalLogger(() => undefined));
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO ridr.profiles(id,display_name) VALUES ($1,$2),($3,$4)', [owner, 'History owner', other, 'Other account']);
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      await client.query(
        `INSERT INTO ridr.rides(id,name,transport,state,leader_member_id,created_at,started_at,ended_at)
         VALUES ($1,$2,'cycling','ended',$3,$4::timestamptz - interval '1 minute',$4,$5)`,
        [record.ride, `History ${index}`, record.member, starts[index], ends[index]],
      );
      await client.query(
        `INSERT INTO ridr.memberships(id,ride_id,user_id,physical_role,joined_at)
         VALUES ($1,$2,$3,'rider',$4::timestamptz - interval '1 minute')`,
        [record.member, record.ride, index === 3 ? other : owner, starts[index]],
      );
    }
    await client.query('COMMIT');

    const first = await store.list(account(owner), 1);
    assert.deepEqual(first.items.map((item) => item.rideId), [records[0]!.ride]);
    assert.equal(first.items[0]?.recordedDistanceM, 0);
    assert.ok(first.nextCursor);
    const second = await store.list(account(owner), 1, first.nextCursor!);
    assert.deepEqual(second.items.map((item) => item.rideId), [records[1]!.ride]);
    assert.equal(second.nextCursor, null);
    assert.deepEqual((await store.list(account(other), 10)).items.map((item) => item.rideId), [records[3]!.ride]);
    for (const invalid of [first.nextCursor!, 'broken']) {
      await assert.rejects(
        store.list(account(other), 1, invalid),
        (error: unknown) => error instanceof ApiError && error.code === 'INVALID_REQUEST',
      );
    }
    await assert.rejects(
      store.read(account(owner), records[2]!.ride),
      (error: unknown) => error instanceof ApiError && error.code === 'HISTORY_EXPIRED',
    );
    await assert.rejects(
      store.read(account(other), records[2]!.ride),
      (error: unknown) => error instanceof ApiError && error.code === 'NOT_FOUND',
    );

    await pool.query(
      `INSERT INTO ridr.sharing_periods(membership_id,epoch,started_at,stopped_at) VALUES ($1,1,$2,$3)`,
      [records[0]!.member, starts[0], ends[0]],
    );
    await pool.query("INSERT INTO ridr.devices(id,user_id,platform) VALUES ($1,$2,'android')", [device, owner]);
    for (let index = 0; index < 2; index++) {
      await pool.query(
        `INSERT INTO ridr.location_samples
         (id,membership_id,user_id,ride_id,device_id,consent_epoch,captured_at,lat,lon,accuracy_m)
         VALUES ($1,$2,$3,$4,$5,1,$6,18.5,$7,5)`,
        [randomUUID(), records[0]!.member, owner, records[0]!.ride, device,
          new Date(starts[0]!.getTime() + 10000 + index * 10000), 73 + index * 0.001],
      );
    }
    const refreshed = await store.list(account(owner), 1);
    assert.ok(refreshed.items[0]!.recordedDistanceM > 100);
    assert.ok(refreshed.items[0]!.updatedAt > first.items[0]!.updatedAt);

    const app = await createApp(readConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl }), {
      accounts: { verifier, profiles: { close: async () => undefined } } as AccountServices,
      logSink: () => undefined,
    });
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const response = await fetch(`${origin}/v1/history?limit=1`, { headers: { Authorization: 'Bearer owner' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.json()).data.items[0].rideId, records[0]!.ride);
      const invalid = await fetch(`${origin}/v1/history?limit=0`, { headers: { Authorization: 'Bearer owner' } });
      assert.equal(invalid.status, 400);
    } finally {
      await app.close();
    }
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('BEGIN');
    await client.query('DELETE FROM ridr.location_samples WHERE ride_id=ANY($1::uuid[])', [records.map((record) => record.ride)]);
    await client.query('DELETE FROM ridr.sharing_periods WHERE membership_id=ANY($1::uuid[])', [records.map((record) => record.member)]);
    await client.query('DELETE FROM ridr.devices WHERE id=$1', [device]);
    await client.query('DELETE FROM ridr.memberships WHERE ride_id=ANY($1::uuid[])', [records.map((record) => record.ride)]);
    await client.query('DELETE FROM ridr.rides WHERE id=ANY($1::uuid[])', [records.map((record) => record.ride)]);
    await client.query('DELETE FROM ridr.profiles WHERE id IN ($1,$2)', [owner, other]);
    await client.query('COMMIT');
    client.release();
    await store.close();
    await pool.end();
  }
});
