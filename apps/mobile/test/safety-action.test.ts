import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safetyOutcomeConfirmed, type SafetyAction } from '../src/rides/safety-action';
import type { RideManagement } from '../src/rides/models';

const action: SafetyAction = {
  kind: 'end',
  rideId: 'ride-a',
  idempotencyKey: 'key',
  consentEpoch: 2,
  capturedAt: '2026-09-16T00:00:00Z',
  reason: 'completed',
};
function status(
  state: 'lobby' | 'active' | 'ended',
  sharing = false,
  epoch = 3,
  leftAt: string | null = null,
): RideManagement {
  return {
    ride: { id: 'ride-a', state },
    membership: { sharingEnabled: sharing, consentEpoch: epoch, leftAt },
    proposals: [],
  } as unknown as RideManagement;
}

test('confirmed management reconciles lost end/leave acknowledgements without reopening access', () => {
  assert.equal(safetyOutcomeConfirmed(action, status('active')), false);
  assert.equal(safetyOutcomeConfirmed(action, status('ended')), true);
  assert.equal(safetyOutcomeConfirmed({ ...action, rideId: 'ride-b' }, status('ended')), false);
  assert.equal(safetyOutcomeConfirmed({ ...action, kind: 'leave' }, status('active')), false);
  assert.equal(
    safetyOutcomeConfirmed(
      { ...action, kind: 'leave' },
      status('active', false, 3, action.capturedAt),
    ),
    true,
  );
  assert.equal(safetyOutcomeConfirmed({ ...action, kind: 'leave' }, status('ended')), true);
});

test('stop reconciliation requires sharing off and a later consent epoch', () => {
  const stop = { ...action, kind: 'stop' as const };
  assert.equal(safetyOutcomeConfirmed(stop, status('active', false, 2)), false);
  assert.equal(safetyOutcomeConfirmed(stop, status('active', true, 3)), false);
  assert.equal(safetyOutcomeConfirmed(stop, status('active', false, 3)), true);
});
