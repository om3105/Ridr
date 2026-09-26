import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { registerDevice } from '../location/api';
import { request, type RideClientOptions } from '../rides/api';
// The authenticated live map owns foreground warnings; suppress duplicate OS banners.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldShowBanner: notification.request.content.data?.kind === 'sos',
    shouldShowList: notification.request.content.data?.kind === 'sos',
    shouldPlaySound: notification.request.content.data?.kind === 'sos',
    shouldSetBadge: false,
  }),
});
let lastRenewal = 0,
  renewing = false;
const preference = (userId: string) => `ridr.push.${userId}`;
async function saveToken(options: RideClientOptions, deviceId: string, token: string | null) {
  await registerDevice(options, deviceId, Platform.OS === 'ios' ? 'ios' : 'android');
  return request(options, {
    path: `/v1/me/devices/${deviceId}/push`,
    method: 'PUT',
    body: { token },
    parse: (value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        !('enabled' in value) ||
        value.enabled !== (token !== null) ||
        !('expiresAt' in value) ||
        (value.expiresAt !== null &&
          (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))))
      )
        throw new Error('Notification registration was not confirmed.');
      return { enabled: value.enabled, expiresAt: value.expiresAt as string | null };
    },
  });
}
async function token() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) throw new Error('The Expo project is not configured.');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}
async function ensureChannels() {
  if (Platform.OS === 'android') {
    await Promise.all([
      Notifications.setNotificationChannelAsync('ride-warnings', {
        name: 'Ride warnings',
        importance: Notifications.AndroidImportance.HIGH,
      }),
      Notifications.setNotificationChannelAsync('ride-sos', {
        name: 'Ride SOS',
        importance: Notifications.AndroidImportance.MAX,
      }),
    ]);
  }
}
export async function enableWarningPush(options: RideClientOptions, deviceId: string) {
  await ensureChannels();
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    throw new Error(
      'Notification permission was denied. Live warnings remain available on the group map.',
    );
  const result = await saveToken(options, deviceId, await token());
  await SecureStore.setItemAsync(preference(options.userId), 'enabled');
  lastRenewal = Date.now();
  return result;
}
export async function disableWarningPush(options: RideClientOptions, deviceId: string) {
  await SecureStore.deleteItemAsync(preference(options.userId));
  while (renewing) await new Promise((resolve) => setTimeout(resolve, 100));
  return saveToken(options, deviceId, null);
}
export async function renewWarningPush(options: RideClientOptions, deviceId: string) {
  if (renewing || Date.now() - lastRenewal < 60000) return;
  renewing = true;
  try {
    if ((await SecureStore.getItemAsync(preference(options.userId))) !== 'enabled') return;
    await ensureChannels();
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      await SecureStore.deleteItemAsync(preference(options.userId));
      await saveToken(options, deviceId, null);
      return;
    }
    await saveToken(options, deviceId, await token());
    lastRenewal = Date.now();
  } finally {
    renewing = false;
  }
}
