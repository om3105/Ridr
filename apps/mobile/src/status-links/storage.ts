import * as SecureStore from 'expo-secure-store';

const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const key = (userId: string, rideId: string) => `ridr.status.pending.${userId}.${rideId}`;
export async function readPendingRevocations(userId: string, rideId: string): Promise<string[]> {
  const saved = await SecureStore.getItemAsync(key(userId, rideId), options);
  if (!saved) return [];
  const value: unknown = JSON.parse(saved);
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
  )
    throw new Error('Saved status-link changes are invalid.');
  return value;
}
export async function savePendingRevocations(userId: string, rideId: string, ids: string[]) {
  await SecureStore.setItemAsync(key(userId, rideId), JSON.stringify([...new Set(ids)]), options);
}
