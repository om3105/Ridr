import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { idleDiagnostic, type DiagnosticStatus } from './diagnostic-types';
import { proveEncryptedDatabase } from './encryption-proof';
import {
  canCollect,
  DIAGNOSTIC_DURATION_MS,
  DIAGNOSTIC_SAMPLE_LIMIT,
  sampleEvidence,
  type DiagnosticConsent,
} from './policy';

const TASK_NAME = 'ridr-day-05-location-check';
const DATABASE_NAME = 'ridr-device-check.db';
const KEY_NAME = 'ridr-device-check-key';
const keyOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
let database: SQLite.SQLiteDatabase | null = null;
let consent: DiagnosticConsent | null = null;
let subscription: Location.LocationSubscription | null = null;
let timeout: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let status: DiagnosticStatus = { ...idleDiagnostic };
let operation: Promise<unknown> = Promise.resolve();
let initialization: Promise<void> | null = null;
const listeners = new Set<(value: DiagnosticStatus) => void>();

function publish(update: Partial<DiagnosticStatus>) {
  status = { ...status, ...update };
  for (const listener of listeners) listener({ ...status });
}

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = operation.then(work, work);
  operation = next.catch(() => undefined);
  return next;
}

export function getDiagnosticStatus(): DiagnosticStatus {
  return { ...status };
}

export function subscribeDiagnostics(listener: (value: DiagnosticStatus) => void) {
  listeners.add(listener);
  listener(getDiagnosticStatus());
  return () => {
    listeners.delete(listener);
  };
}

async function stopNativeAndErase() {
  subscription?.remove();
  subscription = null;
  if (timeout) clearTimeout(timeout);
  timeout = null;
  const failures: unknown[] = [];
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    if (database) await database.closeAsync();
  } catch (error) {
    failures.push(error);
  }
  database = null;
  // Deleting the key also prevents a failed file deletion from leaving readable evidence.
  try {
    await SecureStore.deleteItemAsync(KEY_NAME, keyOptions);
  } catch (error) {
    failures.push(error);
  }
  try {
    // SQLite deletion rejects a missing file. Opening without queries creates an
    // empty file on first launch and does not decrypt/read an existing database.
    const handle = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
    await handle.closeAsync();
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new Error(
      'Cleanup could not finish. Turn off Ridr location access in phone settings and retry.',
    );
}

export function stopAndClearDiagnostics(): Promise<void> {
  return stopDiagnostics(false);
}

function stopDiagnostics(keepSummary: boolean): Promise<void> {
  generation += 1;
  consent = null; // Revoke synchronously, including callbacks already waiting for storage.
  return serialize(async () => {
    try {
      await stopNativeAndErase();
      publish({
        ...(keepSummary ? {} : idleDiagnostic),
        state: 'stopped',
        expiresAt: null,
        message: 'Location check stopped. Local evidence and its key were cleared.',
      });
    } catch (error) {
      publish({
        ...idleDiagnostic,
        state: 'error',
        message:
          'Cleanup could not finish. Turn off Ridr location access in phone settings and retry.',
      });
      throw error;
    }
  });
}

export function initializeDiagnostics(): Promise<void> {
  // A new UI process never inherits a previous location check or starts one itself.
  initialization ??= stopAndClearDiagnostics().catch((error) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

async function failCheck() {
  try {
    await stopAndClearDiagnostics();
  } catch {
    /* Cleanup status already explains recovery. */
  }
  publish({
    state: 'error',
    message:
      'The location check stopped. Review permissions and retry; if cleanup failed, disable Ridr location access in settings.',
  });
}

async function acceptLocations(locations: Location.LocationObject[]) {
  const expectedGeneration = generation;
  const activeConsent = consent;
  if (!activeConsent) {
    if (status.state === 'starting') return;
    await stopDiagnostics(true);
    return;
  }
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  if (expectedGeneration !== generation) return;
  if (!canCollect(activeConsent, Date.now(), foreground.granted, background.granted)) {
    await stopDiagnostics(Date.now() >= activeConsent.expiresAt);
    return;
  }
  await serialize(async () => {
    if (expectedGeneration !== generation || !database || consent !== activeConsent) return;
    for (const sample of locations.slice(0, DIAGNOSTIC_SAMPLE_LIMIT)) {
      if (
        status.count >= DIAGNOSTIC_SAMPLE_LIMIT ||
        !canCollect(activeConsent, Date.now(), foreground.granted, background.granted)
      )
        break;
      const evidence = sampleEvidence(
        sample,
        activeConsent,
        Date.now(),
        AppState.currentState !== 'active',
      );
      if (!evidence) continue;
      const saved = await database.runAsync(
        'INSERT OR IGNORE INTO samples (captured_at, received_at, background, accuracy_metres) VALUES (?, ?, ?, ?)',
        evidence.capturedAt,
        evidence.receivedAt,
        evidence.inBackground ? 1 : 0,
        evidence.accuracyMetres,
      );
      if (expectedGeneration !== generation) return;
      if (saved.changes)
        publish({
          count: status.count + 1,
          backgroundCount: status.backgroundCount + (evidence.inBackground ? 1 : 0),
          lastSampleAt: evidence.capturedAt,
        });
    }
  });
  if (status.count >= DIAGNOSTIC_SAMPLE_LIMIT) await stopDiagnostics(true);
}

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    TASK_NAME,
    async ({ data, error }) => {
      // Consent is deliberately memory-only: headless relaunch stops, never resumes a test.
      if (error || !data || !Array.isArray(data.locations)) return failCheck();
      try {
        await acceptLocations(data.locations);
      } catch {
        await failCheck();
      }
    },
  );
}

export async function startDiagnostics(options: {
  background: boolean;
  consentGiven: boolean;
}): Promise<void> {
  if (!options.consentGiven)
    throw new Error('Choose Start after reading the location check explanation.');
  const initialized = initializeDiagnostics();
  const requestedGeneration = ++generation;
  await initialized;
  return serialize(async () => {
    if (requestedGeneration !== generation) return;
    try {
      consent = null;
      await stopNativeAndErase();
      publish({
        ...idleDiagnostic,
        state: 'starting',
        message: 'Checking permissions and encrypted storage…',
      });
      const [foreground, background, services] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
        Location.hasServicesEnabledAsync(),
      ]);
      if (!foreground.granted || (options.background && !background.granted))
        throw new Error('Allow the requested location access before starting the check.');
      if (!services)
        throw new Error('Turn on location services in phone settings before starting the check.');
      if (options.background && !(await Location.isBackgroundLocationAvailableAsync()))
        throw new Error('Background location is unavailable in this build.');
      if (!(await SecureStore.isAvailableAsync()))
        throw new Error('Secure storage is unavailable on this device.');
      const key = Array.from(await Crypto.getRandomBytesAsync(32), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      await SecureStore.setItemAsync(KEY_NAME, key, keyOptions);
      if ((await SecureStore.getItemAsync(KEY_NAME, keyOptions)) !== key)
        throw new Error('Secure storage could not reopen the encryption key.');
      await proveEncryptedDatabase(
        () => SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true }),
        key,
      );
      database = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
      await database.execAsync(`PRAGMA key = "x'${key}'"`);
      await database.execAsync(
        'CREATE TABLE samples (captured_at INTEGER PRIMARY KEY, received_at INTEGER NOT NULL, background INTEGER NOT NULL, accuracy_metres INTEGER)',
      );
      if (requestedGeneration !== generation) throw new Error('The location check was canceled.');
      const startedAt = Date.now();
      consent = {
        startedAt,
        expiresAt: startedAt + DIAGNOSTIC_DURATION_MS,
        background: options.background,
      };
      publish({
        state: 'running',
        expiresAt: consent.expiresAt,
        encryption: 'verified',
        message: 'Checking location on this phone. No coordinates are saved or uploaded.',
      });
      timeout = setTimeout(() => {
        void stopDiagnostics(true).catch(() => undefined);
      }, DIAGNOSTIC_DURATION_MS);
      if (options.background) {
        await Location.startLocationUpdatesAsync(TASK_NAME, {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 0,
          timeInterval: 5_000,
          deferredUpdatesInterval: 5_000,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          ...(Platform.OS === 'android'
            ? {
                foregroundService: {
                  notificationTitle: 'Ridr location check',
                  notificationBody:
                    'A brief local device check is running. Return to Ridr to stop and clear it.',
                  killServiceOnDestroy: true,
                },
              }
            : {}),
        });
      } else {
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 0, timeInterval: 5_000 },
          (sample) => {
            void acceptLocations([sample]).catch(failCheck);
          },
          () => {
            void failCheck();
          },
        );
      }
      if (requestedGeneration !== generation) {
        consent = null;
        await stopNativeAndErase();
      }
    } catch (error) {
      consent = null;
      let message = error instanceof Error ? error.message : 'The location check could not start.';
      // Native exceptions can include internal paths or database details; expose only our copy.
      if (
        !/^(Allow |Turn on |Background location|Secure storage|Encrypted storage|Storage did not|The location check|Invalid storage)/.test(
          message,
        )
      )
        message =
          'The location check could not start. Rebuild with encrypted storage and review phone permissions.';
      try {
        await stopNativeAndErase();
      } catch {
        message =
          'Cleanup could not finish. Turn off Ridr location access in phone settings and retry.';
      }
      publish({ ...idleDiagnostic, state: 'error', message });
      throw new Error(message);
    }
  });
}

// Revocation and expiry are also checked on resume because mobile OSs suspend timers.
AppState.addEventListener('change', (nextState) => {
  if (!consent) return;
  if (nextState !== 'active' && !consent.background) {
    void stopDiagnostics(true).catch(() => undefined);
  } else if (nextState === 'active') {
    void acceptLocations([]).catch(failCheck);
  }
});
