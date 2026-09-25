import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { parseProfileChange } from '../src/accounts.js';
import { createApp } from '../src/app.js';
import { ApiError, unauthenticated } from '../src/api-errors.js';
import { readConfig } from '../src/config.js';
import type { VerifiedAccount } from '../src/auth.js';
import type { DatabaseHealth } from '../src/database-health.js';
import type { Profile, ProfileChange } from '../src/profiles.js';

const config = readConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/ridr',
});
const database: DatabaseHealth = {
  check: async () => ({
    status: 'ok',
    service: 'ridr-api',
    checks: { database: 'up', schema: 'up', postgis: 'up' },
  }),
  close: async () => undefined,
};
const account: VerifiedAccount = {
  id: randomUUID(),
  sessionId: randomUUID(),
  initialDisplayName: 'Mira',
  expiresAt: Date.now() / 1000 + 300,
};
const initial: Profile = {
  id: account.id,
  displayName: 'Mira',
  createdAt: new Date().toISOString(),
  revision: 1,
  activeMembership: null,
  entitlement: { adFree: false, evaluatedAt: new Date().toISOString() },
  deletionState: 'none',
};
const isCode = (status: number, code: string) => (error: unknown) =>
  error instanceof ApiError && error.status === status && error.code === code;

test('profile requests reject injected identities, invalid names and missing concurrency controls', () => {
  const key = randomUUID();
  for (const body of [
    undefined,
    [],
    {},
    { displayName: 'Mira', actorId: randomUUID() },
    { displayName: 'Mira', role: 'leader' },
  ]) {
    assert.throws(() => parseProfileChange(body, '"1"', key), isCode(400, 'INVALID_REQUEST'));
  }
  for (const displayName of [
    '',
    '  ',
    '<script>',
    'Mira\nDeo',
    'Mira\u0000',
    'x'.repeat(81),
    null,
    10,
  ]) {
    assert.throws(
      () => parseProfileChange({ displayName }, '"1"', key),
      isCode(422, 'VALIDATION_FAILED'),
    );
  }
  assert.deepEqual(parseProfileChange({ displayName: '  मीरा  ' }, '"2"', key), {
    displayName: '  मीरा  ',
    revision: 2,
    idempotencyKey: key,
  });
  assert.throws(
    () => parseProfileChange({ displayName: 'Mira' }, undefined, key),
    isCode(428, 'PRECONDITION_REQUIRED'),
  );
  for (const revision of ['1', 'W/"1"', '"0"', '"1", "2"', '"9007199254740992"']) {
    assert.throws(
      () => parseProfileChange({ displayName: 'Mira' }, revision, key),
      isCode(400, 'INVALID_REQUEST'),
    );
  }
  assert.throws(
    () => parseProfileChange({ displayName: 'Mira' }, '"1"', 'not-uuid'),
    isCode(400, 'INVALID_REQUEST'),
  );
});

test('account HTTP routes derive identity, provide revision envelopes, protect errors and release services', async (t) => {
  let revoked = false;
  let writes = 0;
  let reads = 0;
  let closed = 0;
  const lines: string[] = [];
  const app = await createApp(config, {
    database,
    logSink: (line) => lines.push(line),
    accounts: {
      verifier: {
        verify: async (authorization) => {
          if (revoked || authorization !== 'Bearer private-token') throw unauthenticated();
          return account;
        },
        assertActive: async () => undefined,
        close: async () => {
          closed += 1;
        },
      },
      profiles: {
        readContact: async () => null,
        saveContact: async (_actor, change) => ({
          name: change.name,
          phone: change.phone,
          revision: 1,
        }),
        deleteContact: async () => undefined,
        read: async (actor) => {
          assert.equal(actor.id, account.id);
          reads += 1;
          return initial;
        },
        update: async (actor, change: ProfileChange) => {
          assert.equal(actor.id, account.id);
          writes += 1;
          if (change.displayName === 'database-outage')
            throw new Error('postgresql://private-password@host/ridr');
          return { ...initial, displayName: change.displayName.trim(), revision: 2 };
        },
        close: async () => {
          closed += 1;
        },
      },
    },
  });
  t.after(async () => {
    await app.close();
    assert.equal(closed, 2);
  });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const headers = {
    Authorization: 'Bearer private-token',
    'Content-Type': 'application/json',
    'If-Match': '"1"',
    'Idempotency-Key': randomUUID(),
  };
  const noAuth = await fetch(`${url}/v1/me`);
  assert.equal(noAuth.status, 401);
  assert.equal((await noAuth.json()).error.code, 'UNAUTHENTICATED');
  assert.equal(reads, 0);
  const response = await fetch(`${url}/v1/me`, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), '"1"');
  const body = await response.json();
  assert.deepEqual(body.data, initial);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  const saved = await fetch(`${url}/v1/me`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ displayName: '  Ren  ' }),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('etag'), '"2"');
  assert.equal((await saved.json()).data.displayName, 'Ren');
  assert.equal(writes, 1);
  const injected = await fetch(`${url}/v1/me`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ displayName: 'Ren', actorId: randomUUID() }),
  });
  assert.equal(injected.status, 400);
  assert.equal(writes, 1);
  const malformed = await fetch(`${url}/v1/me`, {
    method: 'PATCH',
    headers,
    body: '{"displayName":',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_REQUEST');
  const unsupported = await fetch(`${url}/v1/me`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'text/plain' },
    body: 'Ren',
  });
  assert.equal(unsupported.status, 415);
  const outage = await fetch(`${url}/v1/me`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ displayName: 'database-outage' }),
  });
  assert.equal(outage.status, 503);
  assert.ok(!(await outage.text()).includes('private-password'));
  const contactUrl = `${url}/v1/me/emergency-contact`;
  assert.equal((await fetch(contactUrl, { headers })).status, 200);
  const createHeaders = {
    Authorization: headers.Authorization,
    'Content-Type': headers['Content-Type'],
    'Idempotency-Key': headers['Idempotency-Key'],
    'If-None-Match': '*',
  };
  const contact = { name: 'Private person', phone: '+919876543210' };
  assert.equal(
    (
      await fetch(contactUrl, {
        method: 'PUT',
        headers: createHeaders,
        body: JSON.stringify({ ...contact, userId: randomUUID() }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(contactUrl, {
        method: 'PUT',
        headers: createHeaders,
        body: JSON.stringify({ ...contact, phone: '123' }),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await fetch(contactUrl, {
        method: 'PUT',
        headers: {
          Authorization: headers.Authorization,
          'Content-Type': headers['Content-Type'],
          'Idempotency-Key': headers['Idempotency-Key'],
        },
        body: JSON.stringify(contact),
      })
    ).status,
    428,
  );
  const createdContact = await fetch(contactUrl, {
    method: 'PUT',
    headers: createHeaders,
    body: JSON.stringify(contact),
  });
  assert.equal(createdContact.status, 200);
  assert.equal(createdContact.headers.get('etag'), '"1"');
  assert.equal((await createdContact.json()).data.phone, contact.phone);
  assert.equal((await fetch(contactUrl, { method: 'DELETE', headers })).status, 204);
  revoked = true;
  assert.equal((await fetch(`${url}/v1/me`, { headers })).status, 401);
  assert.equal(reads, 1);
  assert.ok(
    lines.every(
      (line) =>
        !line.includes('private-token') &&
        !line.includes('private-password') &&
        !line.includes('Ren'),
    ),
  );
});

test('unconfigured accounts remain unavailable while health stays accessible', async (t) => {
  const app = await createApp(config, { database, logSink: () => undefined });
  t.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const response = await fetch(`${url}/v1/me`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'TEMPORARILY_UNAVAILABLE');
  assert.equal((await fetch(`${url}/v1/health/live`)).status, 200);
});
