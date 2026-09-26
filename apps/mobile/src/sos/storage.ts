import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import type { SosEvent } from './api';
import { trackingDeviceId } from '../location/tracker';

const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const pendingKey = (userId: string, rideId: string) => `ridr.sos.pending.${userId}.${rideId}`;
const deviceKey = (userId: string) => `ridr.sos.device.${userId}`;

export async function sosDeviceId(userId: string) {
  const existing = await SecureStore.getItemAsync(deviceKey(userId), options);
  if (existing) return existing;
  const id = trackingDeviceId() ?? randomUUID();
  await SecureStore.setItemAsync(deviceKey(userId), id, options);
  return id;
}
export async function readPendingSos(userId: string, rideId: string): Promise<SosEvent | null> {
  const saved = await SecureStore.getItemAsync(pendingKey(userId, rideId), options);
  if (!saved) return null;
  const event = JSON.parse(saved) as SosEvent;
  if (event.rideId !== rideId || event.type !== 'sos.request')
    throw new Error('Saved SOS identity is invalid.');
  return event;
}
export async function savePendingSos(userId: string, event: SosEvent) {
  await SecureStore.setItemAsync(pendingKey(userId, event.rideId), JSON.stringify(event), options);
}
export async function clearPendingSos(userId: string, rideId: string) {
  await SecureStore.deleteItemAsync(pendingKey(userId, rideId), options);
}
