import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { RideError } from '../src/rides/api';
import { newSosEvent, parseSos, readSos, sendSos } from '../src/sos/api';
import { stageSosPosition, takeSosPosition } from '../src/sos/capture';

const rideId = randomUUID();
const userId = randomUUID();
const memberId = randomUUID();
const deviceId = randomUUID();
const at = new Date().toISOString();
const event = newSosEvent(rideId, randomUUID(), at, null);
const accepted = {
  id: event.id,
  rideId,
  reporterMemberId: memberId,
  reporterName: 'Maya',
  deviceId,
  capturedAt: at,
  acceptedAt: at,
  pairSnapshot: null,
  position: null,
  linkedSosIds: [],
  resolution: null,
  deviceReceipts: [],
};
const options = (fetcher: typeof fetch) => ({
  apiUrl: 'https://api.example.test',
  accessToken: 'token',
  userId,
  fetcher,
});

test('SOS keeps the captured ID and makes a lost server response unconfirmed', async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    attempts++;
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['Idempotency-Key'], event.id);
    assert.equal((init?.headers as Record<string, string>)['X-Device-Id'], deviceId);
    assert.deepEqual(JSON.parse(String(init?.body)), { event });
    if (attempts === 1) throw new Error('response lost');
    return Response.json({ data: accepted, requestId: randomUUID() });
  };
  await assert.rejects(
    sendSos(options(fetcher), event, deviceId),
    (error: unknown) => error instanceof RideError && error.unconfirmed,
  );
  assert.deepEqual(await sendSos(options(fetcher), event, deviceId), accepted);
  assert.equal(attempts, 2);
});

test('last shared position stays in memory for only the intended SOS opening', () => {
  const position = { lat: 18.52, lon: 73.85, accuracyM: 12, recordedAt: at };
  stageSosPosition(rideId, position);
  assert.equal(takeSosPosition(randomUUID()), null);
  stageSosPosition(rideId, position);
  assert.deepEqual(takeSosPosition(rideId), position);
  assert.equal(takeSosPosition(rideId), null);
});

test('reconciliation requires matching accepted identity and rejects malformed receipts', async () => {
  const fetcher: typeof fetch = async () =>
    Response.json({ data: { status: 'accepted', sos: accepted }, requestId: randomUUID() });
  assert.deepEqual(await readSos(options(fetcher), event), accepted);
  await assert.rejects(
    readSos(
      options(async () =>
        Response.json({
          data: { status: 'accepted', sos: { ...accepted, id: randomUUID() } },
          requestId: randomUUID(),
        }),
      ),
      event,
    ),
  );
  assert.throws(() =>
    parseSos({
      ...accepted,
      deviceReceipts: [{ deviceId: 'wrong', memberName: 'Other', receivedAt: at }],
    }),
  );
});
