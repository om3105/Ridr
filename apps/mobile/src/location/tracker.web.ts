import type { RideClientOptions } from '../rides/api';
import type { RideManagement } from '../rides/models';
import type { TrackingStatus } from './types';
export async function bindTracking(
  _options: RideClientOptions,
  _refresh?: () => Promise<RideClientOptions>,
) {}
export async function startTracking(_management: RideManagement, _background: boolean) {
  throw new Error('Install the Android or iOS app to share location.');
}
export async function stopTracking() {}
export async function clearTracking() {}
export function subscribeTracking(listener: (status: TrackingStatus) => void) {
  listener({
    sharing: false,
    queued: 0,
    lastCapturedAt: null,
    lastAckAt: null,
    message: 'Location sharing requires the native Android or iOS app.',
    pendingStop: false,
  });
  return () => undefined;
}

export async function prepareTrackingSignOut(_restored?: RideClientOptions) {}
