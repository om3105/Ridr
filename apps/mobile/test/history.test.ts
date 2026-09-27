import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRideHistory, parseHistoryPage } from '../src/history/api';
import { getRideSummary } from '../src/summary/api';
import { RideError } from '../src/rides/api';

const accountId = '9d306983-8713-48e6-80b6-b94156641c46';
const rideId = '90c03156-a273-4985-9edf-14409842c31b';
const stamp = '2026-09-27T10:00:00.000Z';
const item = {
  rideId,
  rideName: 'Pune ride',
  memberId: accountId,
  startedAt: stamp,
  endedAt: stamp,
  recordedDistanceM: 1200,
  participationDurationSeconds: 1800,
  elapsedPaceMinPerKm: 25,
  updatedAt: stamp,
  expiresAt: stamp,
};

test('history client requests the next page and accepts own-metric cards', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/v1/history');
    assert.equal(url.searchParams.get('limit'), '2');
    assert.equal(url.searchParams.get('cursor'), 'next/cursor');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    return Response.json({ data: { items: [item], nextCursor: null }, requestId: accountId });
  };
  const page = await getRideHistory(
    { apiUrl: 'http://127.0.0.1:3000', accessToken: 'access', userId: accountId, fetcher },
    { limit: 2, cursor: 'next/cursor' },
  );
  assert.equal(page.items[0]?.recordedDistanceM, 1200);
  assert.equal(page.nextCursor, null);
});

test('history client rejects duplicate and malformed metric rows', () => {
  assert.throws(() => parseHistoryPage({ items: [item, item], nextCursor: null }, 2, accountId));
  assert.throws(() =>
    parseHistoryPage({ items: [{ ...item, recordedDistanceM: -1 }], nextCursor: null }, 2, accountId),
  );
  assert.throws(() => parseHistoryPage({ items: [item], nextCursor: 5 }, 2, accountId));
  assert.throws(() => parseHistoryPage({ items: [item], nextCursor: null }, 2, rideId));
});

test('an expired summary has distinct recovery text from an unavailable ride', async () => {
  const options = {
    apiUrl: 'http://127.0.0.1:3000', accessToken: 'access', userId: accountId,
  };
  await assert.rejects(
    getRideSummary({ ...options, fetcher: async () => Response.json({ error: { code: 'HISTORY_EXPIRED' } }, { status: 410 }) }, rideId),
    (error: unknown) => error instanceof RideError && error.code === 'expired' && /90 days/.test(error.message),
  );
  await assert.rejects(
    getRideSummary({ ...options, fetcher: async () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }) }, rideId),
    (error: unknown) => error instanceof RideError && error.code === 'not_found',
  );
});
