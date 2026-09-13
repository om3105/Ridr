import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProfileError, requestProfile } from '../src/auth/profile-api';
import {
  authError,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '../src/auth/validation';

const id = '3b8615b6-18c2-4f35-9b57-736a672b3f28';
const key = 'c7d885fb-4bd0-4b80-9aac-d0759bfb9e74';
const profile = {
  id,
  displayName: 'Maya',
  createdAt: '2026-09-13T00:00:00Z',
  revision: 2,
  activeMembership: null,
  entitlement: { adFree: false, evaluatedAt: '2026-09-13T00:00:00Z' },
  deletionState: 'none',
};
const options = { apiUrl: 'http://127.0.0.1:3000', accessToken: 'private-token', userId: id };
const success = (data = profile) => Response.json({ data, requestId: key });

test('profile requests carry identity only in the authorization header and mutations reuse their receipt key', async () => {
  const requests: RequestInit[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, 'http://127.0.0.1:3000/v1/me');
    requests.push(init!);
    return success();
  };
  assert.equal((await requestProfile({ ...options, fetcher })).displayName, 'Maya');
  const change = { displayName: ' Maya ', revision: 1, idempotencyKey: key };
  await requestProfile({ ...options, fetcher, change });
  await requestProfile({ ...options, fetcher, change });
  assert.deepEqual(requests[1], {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer private-token',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'If-Match': '"1"',
      'Idempotency-Key': key,
    },
    body: '{"displayName":"Maya"}',
    signal: requests[1]?.signal,
  });
  assert.equal(requests[1]?.body, requests[2]?.body);
  assert.deepEqual(requests[1]?.headers, requests[2]?.headers);
});

test('profile client refuses another account and malformed entitlement rather than opening the shell', async () => {
  await assert.rejects(
    requestProfile({ ...options, fetcher: async () => success({ ...profile, id: key }) }),
    (error: unknown) => error instanceof ProfileError && error.code === 'invalid',
  );
  await assert.rejects(
    requestProfile({
      ...options,
      fetcher: async () =>
        Response.json({ data: { ...profile, entitlement: null }, requestId: key }),
    }),
    (error: unknown) => error instanceof ProfileError && error.code === 'invalid',
  );
});

test('revoked sessions, deletion, concurrent edits and network uncertainty remain distinct', async () => {
  for (const [status, code] of [
    [401, 'unauthorized'],
    [403, 'blocked'],
    [412, 'conflict'],
    [503, 'unavailable'],
  ] as const) {
    await assert.rejects(
      requestProfile({ ...options, fetcher: async () => new Response('', { status }) }),
      (error: unknown) => error instanceof ProfileError && error.code === code,
    );
  }
  await assert.rejects(
    requestProfile({
      ...options,
      timeoutMs: 5,
      fetcher: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    }),
    (error: unknown) => error instanceof ProfileError && error.code === 'unavailable',
  );
});

test('invalid mutations and service URLs fail before any credential is sent', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return success();
  };
  for (const apiUrl of [
    'http://name:secret@example.test',
    'https://example.test/?token=x',
    'https://example.test/other',
  ]) {
    await assert.rejects(requestProfile({ ...options, apiUrl, fetcher }));
  }
  await assert.rejects(
    requestProfile({
      ...options,
      fetcher,
      change: { displayName: ' ', revision: 1, idempotencyKey: key },
    }),
  );
  assert.equal(calls, 0);
});

test('account validation accepts international names and hides raw provider errors', () => {
  assert.equal(validateDisplayName('किरण 🚲'), null);
  assert.equal(validateDisplayName('🚲'.repeat(80)), null);
  assert.ok(validateDisplayName('🚲'.repeat(81)));
  assert.ok(validateDisplayName('A\nB'));
  assert.ok(validateDisplayName('\nMaya'));
  assert.ok(validateDisplayName('Maya\u0085R'));
  assert.ok(validateDisplayName('<Maya>'));
  assert.equal(validateDisplayName(' Maya '), null);
  assert.equal(validateEmail('rider@example.test'), null);
  assert.ok(validateEmail('missing@address'));
  assert.ok(validatePassword('short'));
  assert.equal(validatePassword('a long unique passphrase'), null);
  assert.ok(!authError({ message: 'private-token' }).includes('private-token'));
  assert.match(authError({ code: 'email_not_confirmed' }), /Verify/);
});
