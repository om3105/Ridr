import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { currentPair, pairQr, parsePairQr, previewPairInvitation } from '../src/rides/pairing';

test('pair QR is bound to one ride and the secret stays in the POST body', async () => {
  const rideId = randomUUID();
  const token = 'A'.repeat(43);
  assert.equal(parsePairQr(pairQr(rideId, token), rideId), token);
  assert.throws(() => parsePairQr(pairQr(randomUUID(), token), rideId));
  assert.throws(() => parsePairQr('https://example.com/?token=' + token, rideId));
  const requests: { url: string; body: string }[] = [];
  const preview = {
    pairInvitationId: randomUUID(),
    counterpart: { memberId: randomUUID(), displayName: 'Pillion', physicalRole: 'pillion' },
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const options = {
    apiUrl: 'https://ridr.example/',
    accessToken: 'test',
    userId: randomUUID(),
    fetcher: async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify({ data: preview, requestId: randomUUID() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  const now = new Date().toISOString();
  const result = await previewPairInvitation(options, rideId, token, {
    capturedAt: now,
    motion: { state: 'stopped', source: 'speed', observedAt: now },
  });
  assert.equal(result.counterpart.displayName, 'Pillion');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url.includes(token), false);
  assert.equal(JSON.parse(requests[0]!.body).token, token);
});

test('current pair read distinguishes a lobby member without a pair', async () => {
  const options = {
    apiUrl: 'https://ridr.example/',
    accessToken: 'test',
    userId: randomUUID(),
    fetcher: async () =>
      new Response(JSON.stringify({ data: { pair: null }, requestId: randomUUID() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  };
  assert.equal(await currentPair(options, randomUUID()), null);
});
