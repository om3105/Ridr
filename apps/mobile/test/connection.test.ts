import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkConnection } from '../src/connection';

const ready = {
  status: 'ok',
  service: 'ridr-api',
  checks: { database: 'up', schema: 'up', postgis: 'up' },
};

test('checks the API readiness endpoint and requires all dependencies to be ready', async () => {
  const result = await checkConnection('http://localhost:3000/', {
    fetcher: async (input, init) => {
      assert.equal(input, 'http://localhost:3000/v1/health/ready');
      assert.equal(init?.cache, 'no-store');
      return Response.json(ready);
    },
  });
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') assert.ok(result.checkedAt > 0);
});

test('does not report a partially unavailable backend as connected', async () => {
  const result = await checkConnection('http://localhost:3000', {
    fetcher: async () => Response.json({ ...ready, checks: { ...ready.checks, schema: 'down' } }),
  });
  assert.equal(result.status, 'invalid-response');
});

test('distinguishes service unavailability from transport failure', async () => {
  assert.equal(
    (
      await checkConnection('https://example.test', {
        fetcher: async () => new Response('', { status: 503 }),
      })
    ).status,
    'unavailable',
  );
  assert.equal(
    (
      await checkConnection('https://example.test', {
        fetcher: async () => {
          throw new TypeError('Failed to fetch');
        },
      })
    ).status,
    'offline',
  );
});

test('rejects malformed successful responses', async () => {
  for (const body of ['<html>proxy</html>', '{}', JSON.stringify({ ...ready, service: 'other' })]) {
    const result = await checkConnection('https://example.test', {
      fetcher: async () => new Response(body),
    });
    assert.equal(result.status, 'invalid-response');
  }
});

test('aborts a request after the deadline and allows a new attempt', async () => {
  const result = await checkConnection('https://example.test', {
    timeoutMs: 5,
    fetcher: async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      }),
  });
  assert.equal(result.status, 'timeout');
  assert.equal(
    (await checkConnection('https://example.test', { fetcher: async () => Response.json(ready) }))
      .status,
    'ready',
  );
});

test('rejects missing, credential-bearing, or non-origin configuration before sending a request', async () => {
  for (const url of [
    '',
    'file:///tmp/api',
    'https://user:secret@example.test',
    'https://example.test/api',
    'https://example.test?token=secret',
  ]) {
    const result = await checkConnection(url, {
      fetcher: async () => {
        assert.fail('Invalid configuration must not send requests');
      },
    });
    assert.equal(result.status, 'not-configured');
  }
});
