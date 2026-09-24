import type { RideClientOptions } from '../rides/api';
export async function enableWarningPush(
  _options: RideClientOptions,
  _deviceId: string,
): Promise<{ enabled: boolean; expiresAt: string | null }> {
  throw new Error('Use the Android or iOS development build for notifications.');
}
export async function disableWarningPush(
  _options: RideClientOptions,
  _deviceId: string,
): Promise<{ enabled: boolean; expiresAt: string | null }> {
  throw new Error('Use the Android or iOS app to change its notification registration.');
}
export async function renewWarningPush(_options: RideClientOptions, _deviceId: string) {}
