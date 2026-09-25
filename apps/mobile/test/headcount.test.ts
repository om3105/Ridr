import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { getHeadcount, headcountQr, parseHeadcountQr } from '../src/rides/headcount';

test('rest-stop QR is bound to one ride and round', () => {
  const rideId = randomUUID(),
    roundId = randomUUID(),
    pairId = randomUUID(),
    challengeId = randomUUID();
  const token = 'A'.repeat(43);
  const qr = headcountQr(rideId, roundId, pairId, {
    challengeId,
    token,
    expiresAt: new Date().toISOString(),
  });
  assert.deepEqual(parseHeadcountQr(qr, rideId, roundId), {
    pairId,
    challengeId,
    scannedToken: token,
  });
  assert.throws(() => parseHeadcountQr(qr, rideId, randomUUID()));
  assert.throws(() => parseHeadcountQr(qr, randomUUID(), roundId));
  assert.throws(() => parseHeadcountQr('ridr-ready:v1:' + token, rideId, roundId));
});

test('member receives own pair progress without the leader pair list', async () => {
  const pair = {
    id: randomUUID(),
    riderName: 'Rider',
    pillionName: 'Pillion',
    confirmed: false,
    confirmedAt: null,
  };
  const round = {
    id: randomUUID(),
    state: 'open',
    revision: 1,
    openedAt: new Date().toISOString(),
    completedAt: null,
    pairingRevision: 1,
    pairIds: [pair.id],
    confirmedPairIds: [],
    pairs: null,
    ownPair: pair,
  };
  const options = {
    apiUrl: 'https://ridr.example/',
    accessToken: 'test',
    userId: randomUUID(),
    fetcher: async () =>
      new Response(JSON.stringify({ data: round, requestId: randomUUID() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  };
  assert.deepEqual(await getHeadcount(options, randomUUID()), round);
});
