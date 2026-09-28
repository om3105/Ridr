import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { unauthenticated } from '../src/api-errors.js';
import type { AccountServices } from '../src/accounts.js';
import { createApp } from '../src/app.js';
import type { TokenVerifier, VerifiedAccount } from '../src/auth.js';
import { readConfig } from '../src/config.js';
import { OperationalLogger } from '../src/logging.js';
import { SponsoredStore } from '../src/sponsored.js';

test('sponsored content requires a current eligible account and permitted placement', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname));
  const pool = new Pool({ connectionString: databaseUrl });
  const fixture = await pool.connect();
  const user = randomUUID(), member = randomUUID(), activeMember = randomUUID();
  const endedRide = randomUUID(), activeRide = randomUUID();
  const card = { id: 'test_partner', title: 'Local bicycle repair',
    description: 'Book a tune-up.', url: 'https://sponsor.example/ridr' };
  const account: VerifiedAccount = { id: user, sessionId: randomUUID(),
    initialDisplayName: 'Sponsor fixture', expiresAt: Date.now() / 1000 + 600 };
  const verifier: TokenVerifier = { verify: async (header) => {
    if (header !== 'Bearer owner') throw unauthenticated();
    return account;
  },
    assertActive: async () => undefined, close: async () => undefined };
  const store = new SponsoredStore(databaseUrl, card, new OperationalLogger(() => undefined));
  const noFill = new SponsoredStore(databaseUrl, undefined, new OperationalLogger(() => undefined));
  try {
    const ended = new Date(Date.now() - 86400000);
    const started = new Date(ended.getTime() - 3600000);
    await fixture.query('BEGIN');
    await fixture.query('INSERT INTO ridr.profiles(id,display_name) VALUES ($1,$2)', [user, 'Sponsor fixture']);
    await fixture.query(
      `INSERT INTO ridr.rides(id,name,transport,state,leader_member_id,created_at,started_at,ended_at)
       VALUES ($1,'Completed ride','cycling','ended',$2,$3::timestamptz - interval '1 minute',$3,$4)`,
      [endedRide, member, started, ended],
    );
    await fixture.query(
      `INSERT INTO ridr.memberships(id,ride_id,user_id,physical_role,joined_at)
       VALUES ($1,$2,$3,'rider',$4::timestamptz - interval '1 minute')`,
      [member, endedRide, user, started],
    );
    await fixture.query('COMMIT');
    assert.deepEqual(await store.read(account, 'home'), card);
    assert.deepEqual(await store.read(account, 'summary', endedRide), card);
    assert.equal(await store.read(account, 'summary', randomUUID()), null);
    assert.equal(await noFill.read(account, 'home'), null);
    const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl,
      SPONSORED_CARD_ID: card.id, SPONSORED_CARD_TITLE: card.title,
      SPONSORED_CARD_DESCRIPTION: card.description, SPONSORED_CARD_URL: card.url });
    const app = await createApp(config, { accounts: { verifier,
      profiles: { close: async () => undefined } } as AccountServices,
      logSink: () => undefined });
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const allowed = await fetch(`${origin}/v1/sponsored-card?placement=home`,
        { headers: { Authorization: 'Bearer owner' } });
      assert.equal(allowed.status, 200);
      assert.deepEqual((await allowed.json()).data, card);
      assert.equal((await fetch(`${origin}/v1/sponsored-card?placement=home`)).status, 401);
      const forbiddenPlacement = await fetch(`${origin}/v1/sponsored-card?placement=map`,
        { headers: { Authorization: 'Bearer owner' } });
      assert.equal(forbiddenPlacement.status, 400);
      const missingRide = await fetch(`${origin}/v1/sponsored-card?placement=summary`,
        { headers: { Authorization: 'Bearer owner' } });
      assert.equal(missingRide.status, 400);
      const activeAt = new Date();
      await fixture.query('BEGIN');
      await fixture.query(
        `INSERT INTO ridr.rides(id,name,transport,state,leader_member_id,created_at,started_at)
         VALUES ($1,'Current ride','cycling','active',$2,$3::timestamptz - interval '1 minute',$3)`,
        [activeRide, activeMember, activeAt],
      );
      await fixture.query('INSERT INTO ridr.memberships(id,ride_id,user_id,physical_role,joined_at) VALUES ($1,$2,$3,$4,$5)',
        [activeMember, activeRide, user, 'rider', activeAt]);
      await fixture.query('INSERT INTO ridr.active_memberships(user_id,membership_id,ride_id) VALUES ($1,$2,$3)',
        [user, activeMember, activeRide]);
      await fixture.query('COMMIT');
      assert.equal(await store.read(account, 'home'), null);
      assert.equal(await store.read(account, 'history'), null);
      assert.equal(await store.read(account, 'summary', endedRide), null);
      const suppressed = await fetch(`${origin}/v1/sponsored-card?placement=home`,
        { headers: { Authorization: 'Bearer owner' } });
      assert.equal((await suppressed.json()).data, null);
      await fixture.query('DELETE FROM ridr.active_memberships WHERE user_id=$1', [user]);
      await fixture.query("INSERT INTO ridr.ad_entitlements(user_id,ad_free_until) VALUES ($1,clock_timestamp()+interval '1 day')", [user]);
      assert.equal(await store.read(account, 'home'), null);
      await fixture.query('DELETE FROM ridr.ad_entitlements WHERE user_id=$1', [user]);
      await fixture.query("UPDATE ridr.profiles SET account_state='deleting',deleted_at=clock_timestamp() WHERE id=$1", [user]);
      assert.equal(await store.read(account, 'home'), null);
    } finally { await app.close(); }
  } finally {
    await fixture.query('ROLLBACK').catch(() => undefined);
    await fixture.query('DELETE FROM ridr.ad_entitlements WHERE user_id=$1', [user]).catch(() => undefined);
    await fixture.query('DELETE FROM ridr.active_memberships WHERE user_id=$1', [user]).catch(() => undefined);
    await fixture.query('DELETE FROM ridr.memberships WHERE user_id=$1', [user]).catch(() => undefined);
    await fixture.query('DELETE FROM ridr.rides WHERE id IN ($1,$2)', [endedRide, activeRide]).catch(() => undefined);
    await fixture.query('DELETE FROM ridr.profiles WHERE id=$1', [user]).catch(() => undefined);
    fixture.release();
    await Promise.all([store.close(), noFill.close(), pool.end()]);
  }
});
