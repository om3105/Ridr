import type { RideManagement } from './models';

export type SafetyAction = {
  kind: 'end' | 'leave' | 'stop';
  rideId: string;
  idempotencyKey: string;
  consentEpoch: number;
  capturedAt: string;
  reason: 'completed' | 'cancelled';
};

export function safetyOutcomeConfirmed(action: SafetyAction, status: RideManagement): boolean {
  if (action.rideId !== status.ride.id) return false;
  if (action.kind === 'end') return status.ride.state === 'ended';
  if (action.kind === 'leave')
    return status.ride.state === 'ended' || status.membership.leftAt !== null;
  return !status.membership.sharingEnabled && status.membership.consentEpoch > action.consentEpoch;
}
