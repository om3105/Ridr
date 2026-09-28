import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { Pool } from 'pg';
import { ApiError } from '../src/api-errors.js';
import type { AccountServices } from '../src/accounts.js';
import { createApp } from '../src/app.js';
import type { TokenVerifier, VerifiedAccount } from '../src/auth.js';
import { readConfig } from '../src/config.js';
import { OperationalLogger } from '../src/logging.js';
import { RideSummaryStore } from '../src/ride-summary.js';

test('private completed-ride photos validate, deduplicate, authorize and delete', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname));
  const directory = await mkdtemp(join(tmpdir(), 'ridr-photo-test-'));
  const before = process.env.PHOTO_MEDIA_DIR;
  process.env.PHOTO_MEDIA_DIR = directory;
  const pool = new Pool({ connectionString: databaseUrl });
  const fixture = await pool.connect();
  const ride = randomUUID(), owner = randomUUID(), other = randomUUID(), outsider = randomUUID();
  const ownerMember = randomUUID(), otherMember = randomUUID(), photoId = randomUUID(), photoId2 = randomUUID(), photoId3 = randomUUID();
  const account = (id: string): VerifiedAccount => ({ id, sessionId: randomUUID(),
    initialDisplayName: 'Photo fixture', expiresAt: Date.now() / 1000 + 600 });
  const verifier: TokenVerifier = { verify: async (header) => account(
    header === 'Bearer owner' ? owner : header === 'Bearer other' ? other : outsider,
  ), assertActive: async () => undefined, close: async () => undefined };
  const store = new RideSummaryStore(databaseUrl, new OperationalLogger(() => undefined));
  const ended = new Date(Date.now() - 86400000);
  const started = new Date(ended.getTime() - 3600000);
  const bytes = await sharp({ create: { width: 500, height: 500, channels: 3,
    background: { r: 100, g: 120, b: 140 } } }).png().toBuffer();
  const motion = () => ({ capturedAt: new Date().toISOString(),
    motion: { state: 'stopped' as const, source: 'speed' as const,
      observedAt: new Date().toISOString() } });
  try {
    await fixture.query('BEGIN');
    await fixture.query('INSERT INTO ridr.profiles(id,display_name) VALUES ($1,$2),($3,$4),($5,$6)',
      [owner, 'Photo owner', other, 'Other rider', outsider, 'Outsider']);
    await fixture.query(
      `INSERT INTO ridr.rides(id,name,transport,state,leader_member_id,created_at,started_at,ended_at)
       VALUES ($1,'Finished route','cycling','ended',$2,$3::timestamptz - interval '1 minute',$3,$4)`,
      [ride, ownerMember, started, ended],
    );
    await fixture.query(
      `INSERT INTO ridr.memberships(id,ride_id,user_id,physical_role,joined_at)
       VALUES ($1,$3,$4,'rider',$6::timestamptz - interval '1 minute'),
              ($2,$3,$5,'rider',$6::timestamptz - interval '1 minute')`,
      [ownerMember, otherMember, ride, owner, other, started],
    );
    await fixture.query(
      `INSERT INTO ridr.routes(ride_id,revision,profile,source,points,updated_at)
       VALUES ($1,1,'cycling','drawn',$2::jsonb,$3)`,
      [ride, JSON.stringify([{ lat: 18.52, lon: 73.85 }, { lat: 18.521, lon: 73.851 }]), started],
    );
    await fixture.query('COMMIT');
    await assert.rejects(store.uploadPhoto(account(outsider), ride, {
      photoId, routePoint: { lat: 18.52, lon: 73.85 }, motion: motion(), bytes,
    }), (error: unknown) => error instanceof ApiError && error.status === 404);
    await assert.rejects(store.uploadPhoto(account(owner), ride, {
      photoId, routePoint: { lat: 19, lon: 74 }, motion: motion(), bytes,
    }), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_PHOTO_POINT');
    const uploaded = await store.uploadPhoto(account(owner), ride, {
      photoId, routePoint: { lat: 18.52, lon: 73.85 }, motion: motion(), bytes,
    });
    assert.equal(uploaded.own, true);
    assert.equal(uploaded.authorName, 'Photo owner');
    assert.equal((await store.listPhotos(account(other), ride)).items[0]?.own, false);
    assert.equal((await sharp(await store.photoContent(account(other), ride, photoId)).metadata()).format, 'jpeg');
    assert.equal((await store.uploadPhoto(account(owner), ride, {
      photoId, routePoint: { lat: 18.52, lon: 73.85 }, motion: motion(), bytes,
    })).id, photoId);
    await assert.rejects(store.uploadPhoto(account(owner), ride, {
      photoId, routePoint: { lat: 18.521, lon: 73.851 }, motion: motion(), bytes,
    }), (error: unknown) => error instanceof ApiError && error.code === 'PHOTO_CONFLICT');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM ridr.media_assets WHERE id=$1',
      [photoId])).rows[0].count, 1);
    await store.uploadPhoto(account(owner), ride, {
      photoId: photoId2, routePoint: { lat: 18.521, lon: 73.851 }, motion: motion(), bytes,
    });
    const firstPage = await store.listPhotos(account(owner), ride, 1);
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);
    const nextPage = await store.listPhotos(account(owner), ride, 1, firstPage.nextCursor!);
    assert.equal(nextPage.items.length, 1);
    assert.notEqual(nextPage.items[0]!.id, firstPage.items[0]!.id);
    await assert.rejects(store.listPhotos(account(other), ride, 1, firstPage.nextCursor!),
      (error: unknown) => error instanceof ApiError && error.code === 'INVALID_REQUEST');
    await assert.rejects(store.photoContent(account(outsider), ride, photoId),
      (error: unknown) => error instanceof ApiError && error.status === 404);
    await assert.rejects(store.deletePhoto(account(other), ride, photoId),
      (error: unknown) => error instanceof ApiError && error.status === 404);
    const app = await createApp(readConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl }), {
      accounts: { verifier, profiles: { close: async () => undefined } } as AccountServices,
      logSink: () => undefined,
    });
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const response = await fetch(`${origin}/v1/history/${ride}/photos/${photoId}/content`,
        { headers: { Authorization: 'Bearer other' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('content-type'), 'image/jpeg');
      const denied = await fetch(`${origin}/v1/history/${ride}/photos`,
        { headers: { Authorization: 'Bearer outsider' } });
      assert.equal(denied.status, 404);
      const proof = motion();
      const form = new FormData();
      form.append('photoId', photoId3);
      form.append('routePoint', JSON.stringify({ lat: 18.5205, lon: 73.8505 }));
      form.append('capturedAt', proof.capturedAt);
      form.append('motion', JSON.stringify(proof.motion));
      form.append('photo', new Blob([Uint8Array.from(bytes)], { type: 'image/png' }), 'test.png');
      const accepted = await fetch(`${origin}/v1/history/${ride}/photos`, {
        method: 'POST', headers: { Authorization: 'Bearer owner', 'Idempotency-Key': photoId3 },
        body: form,
      });
      const acceptedBody = await accepted.json();
      assert.equal(accepted.status, 201, JSON.stringify(acceptedBody));
      assert.equal(acceptedBody.data.id, photoId3);
      const badCursor = await fetch(`${origin}/v1/history/${ride}/photos?cursor=broken`,
        { headers: { Authorization: 'Bearer owner' } });
      assert.equal(badCursor.status, 400);
    } finally { await app.close(); }
    await store.deletePhoto(account(owner), ride, photoId);
    assert.deepEqual(new Set((await store.listPhotos(account(owner), ride)).items.map((item) => item.id)),
      new Set([photoId2, photoId3]));
    await assert.rejects(stat(join(directory, `${photoId}.jpg`)));
    await pool.query("UPDATE ridr.profiles SET account_state='deleting',deleted_at=clock_timestamp() WHERE id=$1", [owner]);
    assert.deepEqual((await store.listPhotos(account(other), ride)).items, []);
    await assert.rejects(store.photoContent(account(other), ride, photoId2),
      (error: unknown) => error instanceof ApiError && error.status === 404);
    assert.equal(await store.sweepPhotos(), 2);
    await assert.rejects(stat(join(directory, `${photoId2}.jpg`)));
    await assert.rejects(stat(join(directory, `${photoId3}.jpg`)));
    const orphan = join(directory, `${randomUUID()}.jpg`);
    await writeFile(orphan, bytes);
    await utimes(orphan, new Date(Date.now() - 7200000), new Date(Date.now() - 7200000));
    assert.equal(await store.sweepPhotos(), 0);
    await assert.rejects(stat(orphan));
  } finally {
    await fixture.query('ROLLBACK').catch(() => undefined);
    fixture.release();
    await pool.query('DELETE FROM ridr.media_assets WHERE ride_id=$1', [ride]).catch(() => undefined);
    await pool.query('DELETE FROM ridr.routes WHERE ride_id=$1', [ride]).catch(() => undefined);
    await pool.query('DELETE FROM ridr.memberships WHERE ride_id=$1', [ride]).catch(() => undefined);
    await pool.query('DELETE FROM ridr.rides WHERE id=$1', [ride]).catch(() => undefined);
    await pool.query('DELETE FROM ridr.profiles WHERE id IN ($1,$2,$3)', [owner, other, outsider]).catch(() => undefined);
    await store.close();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
    if (before === undefined) delete process.env.PHOTO_MEDIA_DIR;
    else process.env.PHOTO_MEDIA_DIR = before;
  }
});
