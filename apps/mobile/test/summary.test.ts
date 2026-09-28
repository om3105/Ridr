import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRideSummary, parseRideSummary, summaryTraceGeometry } from '../src/summary/api';

const rideId = '90c03156-a273-4985-9edf-14409842c31b';
const memberId = '9d306983-8713-48e6-80b6-b94156641c46';
const stamp = '2026-09-27T10:00:00.000Z';
const value = {
  rideId,
  rideName: 'Pune ride',
  memberId,
  displayName: 'Rider',
  startedAt: stamp,
  endedAt: stamp,
  participationStartedAt: stamp,
  participationEndedAt: stamp,
  recordedDistanceM: 1200,
  participationDurationSeconds: 1800,
  elapsedPaceMinPerKm: 25,
  averageSpeedKmh: 2.4,
  sampleCount: 2,
  excludedSamples: 0,
  gapCount: 1,
  gaps: [{ from: stamp, to: stamp, reason: 'missing_samples' }],
  trace: {
    segments: [
      [
        { lat: 18.5, lon: 73.8 },
        { lat: 18.501, lon: 73.801 },
      ],
    ],
    shownPoints: 2,
    previewComplete: true,
  },
  routePoints: [],
  memberEvents: [{ memberId, displayName: 'Rider', kind: 'sharing_stopped', at: stamp }],
  memberEventsComplete: true,
  updatedAt: stamp,
  expiresAt: stamp,
};

test('summary client reads only the requested ride and preserves disconnected map segments', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, `/v1/history/${rideId}`);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    return Response.json({ data: value, requestId: memberId });
  };
  const result = await getRideSummary(
    { apiUrl: 'http://127.0.0.1:3000', accessToken: 'access', userId: memberId, fetcher },
    rideId,
  );
  assert.equal(result.recordedDistanceM, 1200);
  assert.equal(summaryTraceGeometry(result).features[0]?.geometry.type, 'LineString');
  assert.throws(() => parseRideSummary({ ...value, rideId: memberId }, rideId));
  assert.throws(() =>
    parseRideSummary({ ...value, trace: { ...value.trace, shownPoints: 3 } }, rideId),
  );
  assert.throws(() =>
    parseRideSummary({ ...value, trace: { ...value.trace, segments: [[]], shownPoints: 0 } }, rideId),
  );
});
