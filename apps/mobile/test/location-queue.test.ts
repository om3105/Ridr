import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  LocationQueue,
  retryDelay,
  MAX_AGE_MS,
  type QueueDependencies,
} from '../src/location/queue';
import type { QueueState, Sharing } from '../src/location/types';
function fixture(restored?: QueueState) {
  let now = Date.parse('2026-09-20T10:00:00.000Z');
  let saved: QueueState | undefined;
  const calls: string[] = [];
  const state: QueueState = restored ?? {
    owner: randomUUID(),
    deviceId: randomUUID(),
    consent: null,
    samples: [],
    pendingStop: null,
    enableIntent: null,
  };
  const deps: QueueDependencies = {
    now: () => now,
    uuid: randomUUID,
    save: async (value) => {
      saved = structuredClone(value);
    },
    register: async () => {
      calls.push('register');
    },
    enable: async (intent) => {
      calls.push('enable');
      return {
        enabled: true,
        consentEpoch: intent.epoch,
        revision: 2,
        effectiveAt: new Date(now).toISOString(),
      };
    },
    stop: async (intent) => {
      calls.push('stop');
      return {
        enabled: false,
        consentEpoch: intent.consentEpoch + 1,
        revision: 3,
        effectiveAt: intent.stoppedAt,
      };
    },
    current: async () => {
      calls.push('current');
      return { active: true, sharing: true, epoch: 1 };
    },
    live: async (_device, sample) => {
      calls.push('live');
      return sample.id;
    },
    history: async (_device, samples) => {
      calls.push('history');
      return { accepted: samples.map((s) => s.id), rejected: [] };
    },
    publish: () => undefined,
    permanent: () => false,
  };
  const queue = new LocationQueue(state, deps);
  const start = () =>
    queue.start({ rideId: 'ae87d601-2556-4fb6-9acb-a006380d681a', epoch: 1, interval: 5 }, 1);
  const fix = (overrides = {}) =>
    queue.capture({
      timestamp: now,
      latitude: 18.52,
      longitude: 73.85,
      accuracy: 12,
      speed: 5,
      heading: 90,
      ...overrides,
    });
  return {
    queue,
    deps,
    calls,
    start,
    fix,
    advance: (ms: number) => {
      now += ms;
    },
    saved: () => saved!,
  };
}
test('explicit opt-in, five-second cadence, validation and immediate stop', async () => {
  const f = fixture();
  await f.fix();
  assert.equal(f.queue.state.samples.length, 0);
  await f.start();
  await f.fix();
  await f.fix();
  assert.equal(f.queue.state.samples.length, 1);
  f.advance(5000);
  await f.fix({ latitude: NaN });
  assert.equal(f.queue.state.samples.length, 1);
  await f.fix();
  assert.equal(f.queue.state.samples.length, 2);
  const stopped = f.queue.stop();
  await f.fix();
  assert.equal(f.queue.status().sharing, false);
  await stopped;
  assert.equal(f.queue.state.samples.length, 2);
  assert.ok(f.saved().pendingStop);
  await f.queue.flush();
  assert.ok(f.calls.indexOf('stop') < f.calls.indexOf('history'));
  assert.ok(!f.calls.includes('live'));
  assert.equal(f.queue.state.samples.length, 0);
});
test('lost acknowledgement retries the identical sample ID and removes it only after success', async () => {
  const f = fixture();
  await f.start();
  await f.fix();
  const id = f.queue.state.samples[0]!.id;
  f.deps.live = async () => {
    throw new Error('network lost after commit');
  };
  await assert.rejects(f.queue.flush());
  assert.equal(f.saved().samples[0]!.id, id);
  f.deps.live = async (_device, sample) => {
    assert.equal(sample.id, id);
    return id;
  };
  await f.queue.flush();
  assert.equal(f.saved().samples.length, 0);
});
test('ten-minute outage and restart stop first, then replay history without live collection', async () => {
  const f = fixture();
  await f.start();
  for (let n = 0; n < 120; n++) {
    await f.fix();
    f.advance(5000);
  }
  assert.equal(f.saved().samples.length, 120);
  const restored = fixture(f.saved());
  await restored.queue.recover();
  await restored.queue.flush();
  assert.equal(restored.queue.status().sharing, false);
  assert.equal(restored.queue.state.samples.length, 0);
  assert.ok(restored.calls.indexOf('stop') < restored.calls.indexOf('history'));
  assert.ok(restored.calls.indexOf('current') < restored.calls.indexOf('history'));
  assert.ok(!restored.calls.includes('live'));
});
test('saved history remains queued when authoritative state cannot be checked', async () => {
  const f = fixture();
  await f.start();
  await f.fix();
  const restored = fixture(f.saved());
  await restored.queue.recover();
  restored.deps.current = async () => {
    restored.calls.push('current');
    throw new Error('still offline');
  };
  await assert.rejects(restored.queue.flush());
  assert.equal(restored.queue.state.samples.length, 1);
  assert.ok(!restored.calls.includes('history'));
  restored.deps.current = async () => {
    restored.calls.push('current');
    return { active: false, sharing: false, epoch: 2 };
  };
  await restored.queue.flush();
  assert.equal(restored.queue.state.samples.length, 0);
  assert.ok(restored.calls.indexOf('current') < restored.calls.indexOf('history'));
  assert.ok(!restored.calls.includes('live'));
});
test('old backlog cannot be broadcast as current and expired samples are bounded', async () => {
  const f = fixture();
  await f.start();
  await f.fix();
  f.advance(600000);
  await f.fix();
  await f.queue.flush();
  assert.equal(f.calls.filter((c) => c === 'live').length, 1);
  assert.equal(f.calls.filter((c) => c === 'history').length, 1);
  await f.fix();
  f.advance(MAX_AGE_MS + 1);
  await f.queue.flush();
  assert.equal(f.queue.state.samples.length, 0);
  for (let n = 0; n < 100; n++) {
    assert.ok(retryDelay(n, () => 1) <= 30000);
    assert.ok(retryDelay(n, () => 0) >= 500);
  }
});
test('remote end stops capture before replay and rejected history is removed visibly', async () => {
  const f = fixture();
  await f.start();
  await f.fix();
  f.deps.current = async () => ({ active: false, sharing: false, epoch: 2 });
  await f.queue.flush();
  assert.equal(f.queue.status().sharing, false);
  assert.ok(f.queue.state.pendingStop);
  f.deps.history = async (_d, samples) => ({
    accepted: [],
    rejected: samples.map((s) => ({ id: s.id, code: 'CONSENT_EPOCH_STALE' })),
  });
  await f.queue.flush();
  assert.equal(f.queue.state.samples.length, 0);
  assert.match(f.queue.status().message, /discarded/);
  assert.ok(!f.calls.includes('live'));
});
test('stop during an in-flight enable never starts capture and reconciles the stop', async () => {
  const f = fixture();
  let finish!: (value: Sharing) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.deps.enable = async (_intent) => {
    entered();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const enabling = f.start();
  await started;
  await f.queue.stop();
  finish({ enabled: true, consentEpoch: 1, revision: 2, effectiveAt: '2026-09-20T10:00:00.100Z' });
  await enabling;
  assert.equal(f.queue.state.pendingStop!.stoppedAt, '2026-09-20T10:00:00.100Z');
  assert.equal(f.queue.status().sharing, false);
  await f.queue.flush();
  assert.ok(f.calls.includes('stop'));
});
test('uncertain enable is reconciled with its original key before privacy stop', async () => {
  const f = fixture();
  f.deps.enable = async () => {
    throw new Error('timeout');
  };
  await assert.rejects(f.start());
  const key = f.saved().enableIntent!.idempotencyKey;
  const restored = fixture(f.saved());
  await restored.queue.recover();
  restored.deps.enable = async (intent) => {
    assert.equal(intent.idempotencyKey, key);
    restored.calls.push('enable');
    return { enabled: true, consentEpoch: 1, revision: 2, effectiveAt: '2026-09-20T10:00:00.000Z' };
  };
  await restored.queue.flush();
  assert.deepEqual(restored.calls, ['enable', 'stop']);
  assert.equal(restored.queue.status().sharing, false);
});
test('stop while device registration is waiting cancels enable', async () => {
  const f = fixture();
  let finish!: () => void;
  f.deps.register = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const starting = f.start();
  await f.queue.stop();
  finish();
  await starting;
  assert.ok(!f.calls.includes('enable'));
  assert.equal(f.queue.status().sharing, false);
});

test('storage failure disables capture and a full queue requires reconnection', async () => {
  const f = fixture();
  await f.start();
  f.deps.save = async () => {
    throw new Error('disk full');
  };
  await assert.rejects(f.fix());
  assert.equal(f.queue.status().sharing, false);
  const full = fixture();
  await full.start();
  await full.fix();
  // Exercise the byte cap without allocating tens of thousands of GPS fixtures.
  full.queue.state.samples[0]!.id = 'x'.repeat(26 * 1024 * 1024);
  full.advance(5000);
  await full.fix();
  assert.equal(full.queue.status().sharing, false);
  assert.match(full.queue.status().message, /full/);
  assert.ok(full.queue.state.pendingStop);
});
