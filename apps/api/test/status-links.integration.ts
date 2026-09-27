import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { ApiError } from '../src/api-errors.js';
import { createApp } from '../src/app.js';
import type { TokenVerifier, VerifiedAccount } from '../src/auth.js';
import type { AccountServices } from '../src/accounts.js';
import { readConfig } from '../src/config.js';
import { OperationalLogger } from '../src/logging.js';
import { StatusLinkStore } from '../src/status-links.js';

test('external status links expose only their active owner and expire on every read', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname));
  const pool = new Pool({ connectionString: databaseUrl });
  const accounts: VerifiedAccount[] = [0, 1].map(() => ({
    id: randomUUID(),
    sessionId: randomUUID(),
    initialDisplayName: 'Status rider',
    expiresAt: Date.now() / 1000 + 600,
  }));
  const [owner, other] = accounts as [VerifiedAccount, VerifiedAccount];
  const ride = randomUUID(),
    ownerMember = randomUUID(),
    otherMember = randomUUID();
  const device = randomUUID(),
    otherDevice = randomUUID();
  const verifier: TokenVerifier = {
    verify: async () => {
      throw new Error('Use verified fixtures');
    },
    assertActive: async () => undefined,
    close: async () => undefined,
  };
  const status = new StatusLinkStore(
    databaseUrl,
    verifier,
    'http://127.0.0.1:3000',
    new OperationalLogger((line) => process.stdout.write(`${line}\n`)),
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO ridr.profiles (id,display_name) VALUES ($1,$2),($3,$4)', [
      owner.id,
      'Status owner',
      other.id,
      'Other rider',
    ]);
    await client.query(
      `INSERT INTO ridr.rides (id,name,transport,state,leader_member_id,started_at)
      VALUES ($1,'Status fixture','motorcycle','active',$2,now())`,
      [ride, ownerMember],
    );
    await client.query(
      `INSERT INTO ridr.memberships
      (id,ride_id,user_id,physical_role,sharing,consent_epoch)
      VALUES ($1,$3,$4,'rider',true,1),($2,$3,$5,'rider',true,1)`,
      [ownerMember, otherMember, ride, owner.id, other.id],
    );
    await client.query(
      `INSERT INTO ridr.sharing_periods (membership_id,epoch,started_at)
      VALUES ($1,1,now()),($2,1,now())`,
      [ownerMember, otherMember],
    );
    await client.query(
      `INSERT INTO ridr.devices (id,user_id,platform) VALUES
      ($1,$2,'android'),($3,$4,'android')`,
      [device, owner.id, otherDevice, other.id],
    );
    const sample = randomUUID(),
      otherSample = randomUUID();
    await client.query(
      `INSERT INTO ridr.location_samples
      (id,membership_id,user_id,ride_id,device_id,consent_epoch,captured_at,lat,lon,accuracy_m)
      VALUES ($1,$3,$5,$7,$8,1,now(),18.52,73.85,12),
             ($2,$4,$6,$7,$9,1,now(),19.11,72.91,25)`,
      [
        sample,
        otherSample,
        ownerMember,
        otherMember,
        owner.id,
        other.id,
        ride,
        device,
        otherDevice,
      ],
    );
    await client.query(
      `INSERT INTO ridr.location_latest (membership_id,sample_id)
      VALUES ($1,$3),($2,$4)`,
      [ownerMember, otherMember, sample, otherSample],
    );
    await client.query('COMMIT');

    const key = randomUUID();
    const made = await status.create(owner, ride, key, 1);
    assert.equal(made.tokenAvailable, true);
    assert.match(made.url!, /^http:\/\/127\.0\.0\.1:3000\/v1\/status#[A-Za-z0-9_-]{43}$/);
    const token = made.url!.split('#')[1]!;
    const repeat = await status.create(owner, ride, key, 1);
    assert.equal(repeat.url, null);
    assert.equal(repeat.linkId, made.linkId);
    await assert.rejects(
      status.create(owner, ride, key, 4),
      (error: unknown) => error instanceof ApiError && error.code === 'IDEMPOTENCY_CONFLICT',
    );
    assert.equal((await status.list(owner, ride))[0]?.linkId, made.linkId);
    assert.deepEqual(await status.list(other, ride), []);
    const shown = await status.read(token);
    assert.equal(shown.displayName, 'Status owner');
    assert.equal(shown.lastPosition?.lat, 18.52);
    assert.deepEqual(Object.keys(shown.lastPosition!).sort(), [
      'accuracyM',
      'lat',
      'lon',
      'recordedAt',
    ]);
    assert.equal(shown.sosState, 'none');
    assert.ok(Date.parse(shown.leaseExpiresAt) - Date.parse(shown.servedAt) <= 15000);
    assert.ok(!JSON.stringify(shown).includes('Other rider'));
    const otherSos = randomUUID();
    await pool.query(
      `INSERT INTO ridr.sos_events
      (id,ride_id,reporter_member_id,reporter_user_id,device_id,source,captured_at)
      VALUES ($1,$2,$3,$4,$5,'manual',now())`,
      [otherSos, ride, otherMember, other.id, otherDevice],
    );
    assert.equal((await status.read(token)).sosState, 'none');
    const ownSos = randomUUID();
    await pool.query(
      `INSERT INTO ridr.sos_events
      (id,ride_id,reporter_member_id,reporter_user_id,device_id,source,captured_at)
      VALUES ($1,$2,$3,$4,$5,'manual',now())`,
      [ownSos, ride, ownerMember, owner.id, device],
    );
    assert.equal((await status.read(token)).sosState, 'open');
    await pool.query(
      `INSERT INTO ridr.sos_updates (id,ride_id,sos_id,actor_member_id,kind)
      VALUES ($1,$2,$3,$4,'reporter_okay')`,
      [randomUUID(), ride, ownSos, ownerMember],
    );
    assert.equal((await status.read(token)).sosState, 'reporter_okay');
    const app = await createApp(readConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl }), {
      accounts: { verifier, profiles: { close: async () => undefined } } as AccountServices,
      logSink: () => undefined,
    });
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const publicRead = await fetch(`${origin}/v1/public/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(publicRead.status, 200);
      assert.equal(publicRead.headers.get('cache-control'), 'no-store');
      assert.equal(publicRead.headers.get('referrer-policy'), 'no-referrer');
      assert.equal((await publicRead.json()).data.displayName, 'Status owner');
      const rejected = await fetch(`${origin}/v1/public/status`, {
        headers: { Authorization: 'Bearer invalid' },
      });
      assert.equal(rejected.status, 410);
      assert.ok(!JSON.stringify(await rejected.json()).includes('Status owner'));
    } finally {
      await app.close();
    }
    await assert.rejects(
      status.read(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')),
      (error: unknown) => error instanceof ApiError && error.code === 'STATUS_UNAVAILABLE',
    );
    await assert.rejects(
      status.revoke(other, ride, made.linkId),
      (error: unknown) => error instanceof ApiError && error.code === 'NOT_FOUND',
    );
    await status.revoke(owner, ride, made.linkId);
    await status.revoke(owner, ride, made.linkId);
    await assert.rejects(
      status.read(token),
      (error: unknown) => error instanceof ApiError && error.code === 'STATUS_UNAVAILABLE',
    );

    const stopped = await status.create(owner, ride, randomUUID(), 4);
    const stoppedToken = stopped.url!.split('#')[1]!;
    await pool.query('UPDATE ridr.memberships SET sharing=false WHERE id=$1', [ownerMember]);
    await assert.rejects(
      status.read(stoppedToken),
      (error: unknown) => error instanceof ApiError && error.code === 'STATUS_UNAVAILABLE',
    );
    await assert.rejects(
      status.create(owner, ride, randomUUID(), 1),
      (error: unknown) => error instanceof ApiError && error.code === 'SHARING_REQUIRED',
    );
    await pool.query('UPDATE ridr.memberships SET sharing=true WHERE id=$1', [ownerMember]);
    await pool.query(
      `UPDATE ridr.status_links SET created_at=clock_timestamp()-interval '2 hours',
      expires_at=clock_timestamp()-interval '1 second'
      WHERE id=$1`,
      [stopped.linkId],
    );
    await assert.rejects(
      status.read(stoppedToken),
      (error: unknown) => error instanceof ApiError && error.code === 'STATUS_UNAVAILABLE',
    );
    const left = await status.create(owner, ride, randomUUID(), 1);
    await pool.query(
      'UPDATE ridr.memberships SET sharing=false,left_at=clock_timestamp() WHERE id=$1',
      [ownerMember],
    );
    await assert.rejects(
      status.read(left.url!.split('#')[1]!),
      (error: unknown) => error instanceof ApiError && error.code === 'STATUS_UNAVAILABLE',
    );
    await pool.query('UPDATE ridr.memberships SET sharing=true,left_at=null WHERE id=$1', [
      ownerMember,
    ]);
    const ended = await status.create(owner, ride, randomUUID(), 1);
    await pool.query("UPDATE ridr.rides SET state='ended',ended_at=clock_timestamp() WHERE id=$1", [
      ride,
    ]);
    await assert.rejects(
      status.read(ended.url!.split('#')[1]!),
      (error: unknown) => error instanceof ApiError && error.code === 'STATUS_UNAVAILABLE',
    );
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('BEGIN');
    await client.query('DELETE FROM ridr.command_receipts WHERE actor_id=ANY($1::uuid[])', [
      [owner.id, other.id],
    ]);
    await client.query('DELETE FROM ridr.status_links WHERE ride_id=$1', [ride]);
    await client.query('DELETE FROM ridr.sos_updates WHERE ride_id=$1', [ride]);
    await client.query('DELETE FROM ridr.sos_events WHERE ride_id=$1', [ride]);
    await client.query('DELETE FROM ridr.location_latest WHERE membership_id IN ($1,$2)', [
      ownerMember,
      otherMember,
    ]);
    await client.query('DELETE FROM ridr.location_samples WHERE ride_id=$1', [ride]);
    await client.query('DELETE FROM ridr.sharing_periods WHERE membership_id IN ($1,$2)', [
      ownerMember,
      otherMember,
    ]);
    await client.query('DELETE FROM ridr.devices WHERE user_id=ANY($1::uuid[])', [
      [owner.id, other.id],
    ]);
    await client.query('DELETE FROM ridr.memberships WHERE ride_id=$1', [ride]);
    await client.query('DELETE FROM ridr.rides WHERE id=$1', [ride]);
    await client.query('DELETE FROM ridr.profiles WHERE id=ANY($1::uuid[])', [
      [owner.id, other.id],
    ]);
    await client.query('COMMIT');
    client.release();
    await status.close();
    await pool.end();
  }
});
