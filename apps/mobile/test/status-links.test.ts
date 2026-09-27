import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStatusLink, listStatusLinks, revokeStatusLink } from '../src/status-links/api';

const userId = '3b8615b6-18c2-4f35-9b57-736a672b3f28';
const rideId = '48d6db19-8889-4a35-964a-d82e57fe36cb';
const linkId = '084af2e4-9baf-4dca-b81b-a24344623361';
const key = 'c7d885fb-4bd0-4b80-9aac-d0759bfb9e74';
const requestId = '670b44f2-e22b-4893-980f-30fca30bfaed';
const token = 'a'.repeat(43);
const meta = {
  linkId,
  createdAt: '2026-09-27T00:00:00Z',
  expiresAt: '2026-09-27T04:00:00Z',
  revokedAt: null,
};

test('owner status-link client keeps bearer out of request paths and handles one-time URL', async () => {
  const seen: { path: string; method: string; key: string | null }[] = [];
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({
      path: new URL(url).pathname,
      method: init?.method ?? 'GET',
      key: headers.get('Idempotency-Key'),
    });
    assert.equal(headers.get('Authorization'), 'Bearer test-access-token');
    assert.ok(!url.includes(token));
    calls++;
    if (calls === 4) return new Response(null, { status: 204 });
    const data =
      calls === 1
        ? { ...meta, url: `https://status.example.test/v1/status#${token}`, tokenAvailable: true }
        : calls === 2
          ? { ...meta, url: null, tokenAvailable: false }
          : [meta];
    return Response.json({ data, requestId }, { status: calls === 1 ? 201 : 200 });
  };
  const options = {
    apiUrl: 'http://127.0.0.1:3000',
    accessToken: 'test-access-token',
    userId,
    fetcher,
  };
  assert.equal((await createStatusLink(options, rideId, 4, key)).url?.split('#')[1], token);
  assert.equal((await createStatusLink(options, rideId, 4, key)).url, null);
  assert.equal((await listStatusLinks(options, rideId))[0]?.linkId, linkId);
  await revokeStatusLink(options, rideId, linkId);
  assert.deepEqual(
    seen.map((item) => item.method),
    ['POST', 'POST', 'GET', 'DELETE'],
  );
  assert.equal(seen[0]?.key, key);
  assert.equal(seen[3]?.path, `/v1/rides/${rideId}/status-links/${linkId}`);
});
