import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { acceptScan, getReadiness, parseReadinessQr, readinessQr } from '../src/rides/readiness';

test('readiness QR is bound to ride and pair, with its token sent only in the POST body', async () => {
  const rideId = randomUUID();
  const pairId = randomUUID();
  const challengeId = randomUUID();
  const token = 'A'.repeat(43);
  const qr = readinessQr(rideId, pairId, {
    challengeId,
    token,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  assert.deepEqual(parseReadinessQr(qr, rideId, pairId), { challengeId, scannedToken: token });
  assert.throws(() => parseReadinessQr(qr, randomUUID(), pairId));
  assert.throws(() => parseReadinessQr(qr, rideId, randomUUID()));
  assert.throws(() => parseReadinessQr('https://example.com/?token=' + token, rideId, pairId));

  const requests: { url: string; body: string; key: string | null }[] = [];
  const scanReceiptId = randomUUID();
  const options = {
    apiUrl: 'https://ridr.example/',
    accessToken: 'test',
    userId: randomUUID(),
    fetcher: async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: String(init?.body),
        key: new Headers(init?.headers).get('Idempotency-Key'),
      });
      return new Response(
        JSON.stringify({
          data: { scanReceiptId, pairId, expiresAt: new Date(Date.now() + 60000).toISOString() },
          requestId: randomUUID(),
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    },
  };
  const capturedAt = new Date().toISOString();
  const key = randomUUID();
  assert.equal(
    (
      await acceptScan(
        options,
        rideId,
        pairId,
        challengeId,
        token,
        {
          capturedAt,
          motion: { state: 'stopped', source: 'speed', observedAt: capturedAt },
        },
        key,
      )
    ).scanReceiptId,
    scanReceiptId,
  );
  assert.equal(requests[0]!.url.includes(token), false);
  assert.equal(JSON.parse(requests[0]!.body).scannedToken, token);
  assert.equal(requests[0]!.key, key);
});

test('readiness overview keeps the pillion and leader status distinct', async () => {
  const ownMemberId = randomUUID();
  const pair = {
    id: randomUUID(),
    revision: 1,
    rider: { memberId: randomUUID(), displayName: 'Rider' },
    pillion: { memberId: ownMemberId, displayName: 'Pillion' },
    ready: false,
    confirmedAt: null,
  };
  const options = {
    apiUrl: 'https://ridr.example/',
    accessToken: 'test',
    userId: randomUUID(),
    fetcher: async () =>
      new Response(
        JSON.stringify({
          data: { ownMemberId, ownPair: pair, leaderPairs: null },
          requestId: randomUUID(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
  };
  const result = await getReadiness(options, randomUUID());
  assert.equal(result.ownPair?.pillion.memberId, ownMemberId);
  assert.equal(result.leaderPairs, null);
});
