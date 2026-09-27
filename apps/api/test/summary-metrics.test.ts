import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveSummaryMetrics, type SummarySample } from '../src/summary-metrics.js';

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 27, 10, 0, seconds)).toISOString();
const point = (
  id: string,
  seconds: number,
  lon: number,
  accuracyM = 5,
  consentEpoch = 1,
): SummarySample => ({
  id,
  capturedAt: at(seconds),
  receivedAt: at(seconds),
  lat: 18.5,
  lon,
  accuracyM,
  consentEpoch,
});

test('elapsed pace uses participation time and only continuous recorded distance', () => {
  const result = deriveSummaryMetrics(
    [point('b', 10, 73.001), point('a', 0, 73), point('b', 10, 73.001)],
    [{ startedAt: at(0), stoppedAt: at(60) }],
    at(0),
    at(60),
  );
  assert.equal(result.sampleCount, 2);
  assert.ok(result.recordedDistanceM > 100 && result.recordedDistanceM < 110);
  assert.equal(result.participationDurationSeconds, 60);
  assert.ok(result.elapsedPaceMinPerKm! > 9 && result.elapsedPaceMinPerKm! < 10);
  assert.ok(result.averageSpeedKmh! > 6 && result.averageSpeedKmh! < 7);
  assert.equal(result.trace.segments.length, 1);
  assert.equal(result.trace.segments[0]?.length, 2);
  assert.equal(result.gapCount, 1); // No observation in the last 50 seconds.
});

test('poor accuracy, missing time, consent changes and implausible jumps cannot create distance', () => {
  const samples = [
    point('a', 0, 73),
    point('bad', 5, 73.0005, 90),
    point('b', 10, 73.001),
    point('c', 50, 73.002),
    point('d', 55, 74),
    point('e', 60, 74.001, 5, 2),
  ];
  const result = deriveSummaryMetrics(
    samples,
    [
      { startedAt: at(0), stoppedAt: at(50) },
      { startedAt: at(55), stoppedAt: at(65) },
    ],
    at(0),
    at(65),
  );
  assert.equal(result.recordedDistanceM, 0);
  assert.equal(result.elapsedPaceMinPerKm, null);
  assert.equal(result.averageSpeedKmh, 0);
  assert.equal(result.excludedSamples, 1);
  assert.ok(result.gaps.some((gap) => gap.reason === 'poor_accuracy'));
  assert.ok(result.gaps.some((gap) => gap.reason === 'missing_samples'));
  assert.ok(result.gaps.some((gap) => gap.reason === 'implausible_jump'));
  assert.ok(result.gaps.some((gap) => gap.reason === 'sharing_change'));
  assert.ok(result.gaps.some((gap) => gap.reason === 'sharing_off'));
  assert.ok(result.trace.segments.every((segment) => segment.length === 1));
});

test('zero samples show unavailable pace and an explicit tracking gap', () => {
  const result = deriveSummaryMetrics([], [{ startedAt: at(0), stoppedAt: at(60) }], at(0), at(60));
  assert.equal(result.recordedDistanceM, 0);
  assert.equal(result.elapsedPaceMinPerKm, null);
  assert.equal(result.trace.shownPoints, 0);
  assert.equal(result.trace.previewComplete, true);
  assert.deepEqual(
    result.gaps.map((gap) => gap.reason),
    ['missing_samples'],
  );
});
