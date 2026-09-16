import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MotionTracker } from '../src/rides/motion-policy';

test('motion requires ten consecutive seconds of low speed and five seconds to enter moving', () => {
  const tracker = new MotionTracker();
  const sample = (time: number, speedMps: number) =>
    tracker.observe({ speedMps, accuracyM: 5, observedAt: time }, time);
  for (let t = 0; t < 10000; t += 1000) assert.equal(sample(t, 0.2), 'unknown');
  assert.equal(sample(10000, 0.2), 'stopped');
  for (let t = 11000; t < 16000; t += 1000) assert.equal(sample(t, 3), 'stopped');
  assert.equal(sample(16000, 3), 'moving');
  for (let t = 17000; t < 27000; t += 1000) assert.equal(sample(t, 0), 'moving');
  assert.equal(sample(27000, 0), 'stopped');
});

test('missing, stale, inaccurate and interrupted readings never prove stationary state', () => {
  for (const bad of [
    { speedMps: null, accuracyM: 5, observedAt: 10000 },
    { speedMps: -1, accuracyM: 5, observedAt: 10000 },
    { speedMps: 0, accuracyM: null, observedAt: 10000 },
    { speedMps: 0, accuracyM: 51, observedAt: 10000 },
    { speedMps: 0, accuracyM: 5, observedAt: 4000 },
    { speedMps: 0, accuracyM: 5, observedAt: 12000 },
  ]) {
    const tracker = new MotionTracker();
    for (let t = 0; t < 10000; t += 1000)
      tracker.observe({ speedMps: 0, accuracyM: 5, observedAt: t }, t);
    assert.equal(tracker.observe(bad, 10000), 'unknown');
  }
  const tracker = new MotionTracker();
  tracker.observe({ speedMps: 0, accuracyM: 5, observedAt: 0 }, 0);
  assert.equal(tracker.observe({ speedMps: 0, accuracyM: 5, observedAt: 10000 }, 10000), 'unknown');
  for (let t = 11000; t <= 20000; t += 1000)
    tracker.observe({ speedMps: 0, accuracyM: 5, observedAt: t }, t);
  assert.equal(tracker.current(20000), 'stopped');
  assert.equal(tracker.current(26000), 'unknown');
});
