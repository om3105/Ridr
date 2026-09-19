import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRoute, saveRoute, validPoints, type SaveCommand } from '../src/routes/api';
const id = '10000000-0000-4000-8000-000000000001';
const saved = {
  id,
  source: 'drawn',
  profile: 'cycling',
  revision: 1,
  points: [
    { lat: 18, lon: 73 },
    { lat: 19, lon: 74 },
  ],
};
const options = { apiUrl: 'http://localhost:3000', userId: id, accessToken: 'fixture' };
const capturedAt = new Date().toISOString();
const command: SaveCommand = {
  draft: { points: saved.points, file: null },
  revision: 0,
  idempotencyKey: id,
  motion: { capturedAt, motion: { state: 'stopped', source: 'speed', observedAt: capturedAt } },
};
test('route client preserves revision preconditions and request identity on retries', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls++;
    const headers = init!.headers as Record<string, string>;
    assert.equal(headers['If-None-Match'], '*');
    assert.equal(headers['Idempotency-Key'], id);
    assert.deepEqual(JSON.parse(init!.body as string), { points: saved.points, ...command.motion });
    return Response.json({ data: saved, requestId: id });
  };
  assert.deepEqual(await saveRoute({ ...options, fetcher }, id, command), saved);
  assert.deepEqual(await saveRoute({ ...options, fetcher }, id, command), saved);
  assert.equal(calls, 2);
});
test('route response rejects coordinates or identity from another ride', async () => {
  for (const bad of [
    { ...saved, id: 'other' },
    {
      ...saved,
      points: [
        { lat: 91, lon: 0 },
        { lat: 0, lon: 0 },
      ],
    },
    { ...saved, revision: 0 },
  ]) {
    await assert.rejects(
      getRoute(
        { ...options, fetcher: async () => Response.json({ data: bad, requestId: id }) },
        id,
      ),
    );
  }
  assert.equal(
    await getRoute(
      { ...options, fetcher: async () => Response.json({ data: null, requestId: id }) },
      id,
    ),
    null,
  );
  assert.equal(
    validPoints([
      { lat: NaN, lon: 1 },
      { lat: 1, lon: 2 },
    ]),
    false,
  );
});
test('GPX uses multipart without overriding its boundary and preserves old route revision', async () => {
  const file = new File(['<gpx/>'], 'route.gpx', { type: 'application/gpx+xml' });
  await saveRoute(
    {
      ...options,
      fetcher: async (_input, init) => {
        const headers = init!.headers as Record<string, string>;
        assert.equal(headers['Content-Type'], undefined);
        assert.equal(headers['If-Match'], '"3"');
        const body = init!.body as FormData;
        assert.equal((body.get('file') as File).name, 'route.gpx');
        return Response.json({ data: { ...saved, revision: 4, source: 'gpx' }, requestId: id });
      },
    },
    id,
    {
      ...command,
      revision: 3,
      draft: { points: [], file: { uri: 'blob:fixture', name: 'route.gpx', file } },
    },
  );
});

test('route failures explain recovery and distinguish rejected routing from unconfirmed saves', async () => {
  for (const [status, code, pattern] of [
    [422, 'INVALID_ROUTE', /continuous GPX/],
    [413, 'PAYLOAD_TOO_LARGE', /5 MB/],
    [503, 'ROUTING_UNAVAILABLE', /Pune coverage/],
  ] as const) {
    await assert.rejects(
      saveRoute(
        { ...options, fetcher: async () => Response.json({ error: { code } }, { status }) },
        id,
        command,
      ),
      pattern,
    );
  }
});
