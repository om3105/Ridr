import * as Location from 'expo-location';
import { AppState } from 'react-native';
import type { MotionContext } from './models';
import { MotionTracker } from './motion-policy';

let cancel: (() => void) | null = null;

export function stopMotionCheck() {
  cancel?.();
}

/** Explicit, bounded foreground check. Coordinates are neither retained nor sent. */
export async function checkStationary(): Promise<MotionContext> {
  stopMotionCheck();
  return new Promise<MotionContext>((resolve, reject) => {
    const tracker = new MotionTracker();
    let subscription: Location.LocationSubscription | null = null;
    let finished = false;
    const finish = (context?: MotionContext, message = 'The motion check was cancelled.') => {
      if (finished) return;
      finished = true;
      subscription?.remove();
      clearTimeout(timeout);
      appState.remove();
      if (cancel === stop) cancel = null;
      if (context) resolve(context);
      else reject(new Error(message));
    };
    const stop = () => finish();
    cancel = stop;
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') finish();
    });
    const timeout = setTimeout(
      () =>
        finish(
          undefined,
          'Your phone could not confirm that you are stopped. Wait in a safe place with a clear GPS signal and try again.',
        ),
      25000,
    );
    void (async () => {
      if (AppState.currentState !== 'active') {
        finish();
        return;
      }
      const existing = await Location.getForegroundPermissionsAsync();
      if (finished) return;
      const permission = existing.granted
        ? existing
        : await Location.requestForegroundPermissionsAsync();
      if (finished) return;
      if (!permission.granted) {
        finish(
          undefined,
          'Location access is needed for this brief motion check. End, leave and stop sharing remain available.',
        );
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        finish(undefined, 'Turn on location services to check that you are stopped.');
        return;
      }
      if (finished) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 1000 },
        (sample) => {
          if (finished) return;
          const now = Date.now();
          const state = tracker.observe(
            {
              speedMps: sample.coords.speed,
              accuracyM: sample.coords.accuracy,
              observedAt: sample.timestamp,
            },
            now,
          );
          if (state === 'stopped')
            finish({
              motion: {
                state: 'stopped',
                source: 'speed',
                observedAt: new Date(sample.timestamp).toISOString(),
              },
              capturedAt: new Date(now).toISOString(),
            });
          else if (state === 'moving')
            finish(undefined, 'Stop in a safe place before using this control.');
        },
        () => finish(undefined, 'Motion is unavailable. Check location access and try again.'),
      );
      if (finished) subscription.remove();
    })().catch(() =>
      finish(
        undefined,
        'Motion is unavailable on this device. End, leave and stop sharing remain available.',
      ),
    );
  });
}
