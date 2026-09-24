import { renewWarningPush } from '../notifications/push';
import * as Battery from 'expo-battery';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { stopRideSharing, RideError, type RideClientOptions } from '../rides/api';
import { proveEncryptedDatabase } from '../device/encryption-proof';
import { enableSharing, registerDevice, sendSample, sendHistory, getSharingStatus } from './api';
import { LocationQueue, retryDelay } from './queue';
import type { QueueState, TrackingStatus } from './types';
import type { RideManagement } from '../rides/models';

const TASK = 'ridr-live-location';
const DB = 'ridr-location-queue.db';
const KEY = 'ridr.location.queue.key';
const keyOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
let database: SQLite.SQLiteDatabase | null = null;
let engine: LocationQueue | null = null;
let options: RideClientOptions | null = null;
let subscription: Location.LocationSubscription | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let trackingBackground = false;
let retries = 0;
let retryAfter = 0;
let retrying = false;
let refreshOptions: (() => Promise<RideClientOptions>) | null = null;
let initializing: Promise<void> | null = null;
let status: TrackingStatus = {
  sharing: false,
  queued: 0,
  lastCapturedAt: null,
  lastAckAt: null,
  message: 'Location sharing is off.',
  pendingStop: false,
};
const listeners = new Set<(status: TrackingStatus) => void>();
function publish(next: TrackingStatus) {
  if (!next.sharing) trackingBackground = false;
  status = { ...next, background: trackingBackground };
  for (const listener of listeners) listener({ ...status });
}
export function subscribeTracking(listener: (status: TrackingStatus) => void) {
  listeners.add(listener);
  listener({ ...status });
  return () => {
    listeners.delete(listener);
  };
}
function current() {
  if (!options) throw new Error('Sign in to reconnect location sharing.');
  return options;
}
async function open() {
  if (database) return database;
  let key = await SecureStore.getItemAsync(KEY, keyOptions);
  if (!key) {
    key = Array.from(await Crypto.getRandomBytesAsync(32), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    await SecureStore.setItemAsync(KEY, key, keyOptions);
  }
  await proveEncryptedDatabase(() => SQLite.openDatabaseAsync(DB, { useNewConnection: true }), key);
  const db = await SQLite.openDatabaseAsync(DB, { useNewConnection: true });
  await db.execAsync(`PRAGMA key = "x'${key}'"`);
  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS queue_state (id INTEGER PRIMARY KEY CHECK (id=1), body TEXT NOT NULL)',
  );
  database = db;
  return db;
}
async function stopNative() {
  subscription?.remove();
  subscription = null;
  if (await Location.hasStartedLocationUpdatesAsync(TASK))
    await Location.stopLocationUpdatesAsync(TASK);
}
function schedule(delay = 5000) {
  if (timer) clearTimeout(timer);
  if (!options) return;
  timer = setTimeout(() => {
    void retry();
  }, delay);
}
async function retry() {
  const active = engine;
  if (!active || !options || retrying) return;
  if (Date.now() < retryAfter) {
    schedule(retryAfter - Date.now());
    return;
  }
  retrying = true;
  try {
    const refreshed = await refreshOptions?.();
    if (refreshed && engine === active && options?.userId === refreshed.userId) options = refreshed;
    if (engine !== active || !options) return;
    if (
      active.status().sharing &&
      (!(await Location.hasServicesEnabledAsync()) ||
        (await Location.getForegroundPermissionsAsync()).status !== 'granted')
    )
      await stopTracking();
    await active.flush();
    void renewWarningPush(options, active.state.deviceId).catch(() => undefined);
    retries = 0;
    retryAfter = 0;
  } catch (error) {
    if (error instanceof RideError && ['unauthorized', 'blocked'].includes(error.code))
      await stopTracking().catch(() => undefined);
    retries++;
    retryAfter = Date.now() + retryDelay(retries - 1);
  } finally {
    retrying = false;
  }
  if (!active.status().sharing)
    await stopNative().catch(() => {
      publish({
        ...status,
        message:
          'Collection is off. Disable Ridr location access in Settings if the location indicator remains on.',
      });
    });
  if (engine === active) schedule(retries ? Math.max(1, retryAfter - Date.now()) : 5000);
}
export function bindTracking(
  next: RideClientOptions,
  refresh?: () => Promise<RideClientOptions>,
): Promise<void> {
  if (refresh) refreshOptions = refresh;
  if (engine?.state.owner === next.userId) {
    options = next;
    schedule();
    return Promise.resolve();
  }
  if (initializing) return initializing.then(() => bindTracking(next, refresh));
  const previous = engine;
  engine = null;
  options = null;
  const expected = ++generation;
  initializing = (async () => {
    await previous?.stop();
    await stopNative();
    let db = await open();
    const row = await db.getFirstAsync<{ body: string }>('SELECT body FROM queue_state WHERE id=1');
    let state: QueueState = row
      ? (JSON.parse(row.body) as QueueState)
      : {
          owner: next.userId,
          deviceId: Crypto.randomUUID(),
          consent: null,
          samples: [],
          pendingStop: null,
          enableIntent: null,
        };
    if (state.owner !== next.userId) {
      await eraseStorage();
      db = await open();
      state = {
        owner: next.userId,
        deviceId: Crypto.randomUUID(),
        consent: null,
        samples: [],
        pendingStop: null,
        enableIntent: null,
      };
    }
    if (expected !== generation) return;
    options = next;
    const ownerOptions = () => {
      const value = current();
      if (value.userId !== next.userId) throw new Error('Your account changed.');
      return value;
    };
    engine = new LocationQueue(state, {
      now: Date.now,
      uuid: Crypto.randomUUID,
      save: async (state) => {
        await db.runAsync(
          'INSERT INTO queue_state (id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
          JSON.stringify(state),
        );
      },
      register: (device) =>
        registerDevice(ownerOptions(), device, Platform.OS === 'ios' ? 'ios' : 'android'),
      enable: (intent) => enableSharing(ownerOptions(), intent),
      stop: (intent) => stopRideSharing(ownerOptions(), intent),
      current: (rideId) => getSharingStatus(ownerOptions(), rideId),
      live: (device, sample) => sendSample(ownerOptions(), device, sample),
      history: (device, samples) => sendHistory(ownerOptions(), device, samples),
      publish,
      permanent: (error) => error instanceof RideError && !error.retryable && !error.unconfirmed,
    });
    await engine.recover();
    schedule(1);
  })()
    .catch((error) => {
      publish({
        ...status,
        message:
          'Encrypted location storage could not initialize. Sharing is off. Restart Ridr and try again.',
      });
      throw error;
    })
    .finally(() => {
      initializing = null;
    });
  return initializing;
}
export async function startTracking(management: RideManagement, background: boolean) {
  const active = engine;
  if (!active || !options) throw new Error('Location storage is still initializing. Try again.');
  if (management.ride.state !== 'active' || management.membership.leftAt)
    throw new Error('Join an active ride before sharing.');
  const expected = generation;
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted')
    throw new Error('Location permission was denied. Sharing remains off.');
  if (!(await Location.hasServicesEnabledAsync()))
    throw new Error('Turn on your phone’s location services first.');
  if (background) {
    const permission = await Location.requestBackgroundPermissionsAsync();
    if (permission.status !== 'granted')
      throw new Error(
        'Background permission was denied. Choose foreground sharing or allow access in Settings.',
      );
  }
  if (expected !== generation) return;
  if (!background && AppState.currentState !== 'active')
    throw new Error('Return to Ridr before starting foreground sharing.');
  trackingBackground = background;
  await active.start(
    {
      rideId: management.ride.id,
      epoch: management.membership.consentEpoch + 1,
      interval: management.ride.settings.broadcastIntervalSeconds,
    },
    management.membership.revision,
  );
  if (!active.status().sharing || expected !== generation) return;
  try {
    if (background)
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.High,
        distanceInterval: 0,
        timeInterval: management.ride.settings.broadcastIntervalSeconds * 1000,
        deferredUpdatesInterval: management.ride.settings.broadcastIntervalSeconds * 1000,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        ...(Platform.OS === 'android'
          ? {
              foregroundService: {
                notificationTitle: 'Ridr location sharing',
                notificationBody: 'Sharing your position with your active ride. Open Ridr to stop.',
                killServiceOnDestroy: true,
              },
            }
          : {}),
      });
    else
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 0,
          timeInterval: management.ride.settings.broadcastIntervalSeconds * 1000,
        },
        (location) => {
          void capture([location]);
        },
      );
    if (
      expected !== generation ||
      !active.status().sharing ||
      (!background && AppState.currentState !== 'active')
    )
      await stopTracking();
  } catch (error) {
    await stopTracking();
    throw error;
  }
  schedule(1);
}
async function capture(locations: Location.LocationObject[]) {
  const active = engine;
  if (!active || !options) {
    await stopNative();
    return;
  }
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted' || !(await Location.hasServicesEnabledAsync())) {
      await stopTracking();
      publish({ ...status, message: 'Location permission or services are off. Sharing stopped.' });
      return;
    }
    const level = await Battery.getBatteryLevelAsync().catch(() => -1);
    const batteryPercent = level >= 0 && level <= 1 ? Math.round(level * 100) : null;
    for (const location of locations)
      await active.capture({
        timestamp: location.timestamp,
        ...location.coords,
        batteryPercent: Date.now() - location.timestamp <= 5000 ? batteryPercent : null,
      });
    await retry();
  } catch {
    await stopTracking().catch(() => undefined);
    publish({
      ...status,
      message:
        'Location collection stopped because encrypted storage or the location service failed.',
    });
  }
}
export function stopTracking(): Promise<void> {
  retryAfter = 0;
  if (engine) ++generation;
  const saved = engine?.stop() ?? Promise.resolve();
  const stopped = stopNative();
  schedule(1);
  return Promise.all([saved, stopped]).then(() => undefined);
}
export async function prepareTrackingSignOut(restored?: RideClientOptions): Promise<void> {
  if (!engine && restored) await bindTracking(restored);
  await stopTracking();
  await engine?.flush(true);
  if (engine?.status().pendingStop)
    throw new Error('Reconnect to confirm your location stop before signing out.');
}
export async function clearTracking(): Promise<void> {
  ++generation;
  options = null;
  refreshOptions = null;
  if (timer) clearTimeout(timer);
  timer = null;
  await stopTracking();
  await initializing;
  engine = null;
  await eraseStorage();
  publish({
    sharing: false,
    queued: 0,
    lastCapturedAt: null,
    lastAckAt: null,
    message: 'Location data cleared from this phone.',
    pendingStop: false,
  });
}
TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error) {
    await stopTracking();
    publish({ ...status, message: 'Background location stopped. Open Ridr to check permissions.' });
    return;
  }
  // After OS termination there is no restored authenticated UI context. Stop the
  // native task; bindTracking reconciles durable consent on the next sign-in.
  if (!engine || !options) {
    await stopNative();
    return;
  }
  await capture(data?.locations ?? []);
});
AppState.addEventListener('change', (state) => {
  if (state !== 'active' && subscription) void stopTracking().catch(() => undefined);
  if (state === 'active' && options) schedule(1);
});

async function eraseStorage() {
  if (database) {
    await database.closeAsync();
    database = null;
  }
  await SecureStore.deleteItemAsync(KEY, keyOptions);
  // Delete the encrypted file too; deleting the key alone cryptographically erases it.
  const db = await SQLite.openDatabaseAsync(DB, { useNewConnection: true });
  await db.closeAsync();
  await SQLite.deleteDatabaseAsync(DB);
}

export function trackingDeviceId() {
  return engine?.state.deviceId ?? null;
}
