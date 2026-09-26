import { randomUUID } from 'expo-crypto';
import type { SosEvent } from './api';
const pending = new Map<string, SosEvent>();
const devices = new Map<string, string>();
const key = (userId: string, rideId: string) => `${userId}:${rideId}`;
export async function sosDeviceId(userId: string) {
  let id = devices.get(userId);
  if (!id) {
    id = randomUUID();
    devices.set(userId, id);
  }
  return id;
}
export async function readPendingSos(userId: string, rideId: string) {
  return pending.get(key(userId, rideId)) ?? null;
}
export async function savePendingSos(userId: string, event: SosEvent) {
  pending.set(key(userId, event.rideId), event);
}
export async function clearPendingSos(userId: string, rideId: string) {
  pending.delete(key(userId, rideId));
}
