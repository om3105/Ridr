import { getRoute } from '../routes/api';
import { RouteProgress, groupGaps } from './geometry';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { useRides } from '../rides/provider';
import { getLocations, parseSnapshot } from '../location/api';
import type { LocationSnapshot } from '../location/types';
import { newerSnapshot } from './model';

export function useGroupLocations(
  id: string,
  startedAt: string | null,
  enabled = true,
  onSnapshot?: (snapshot: LocationSnapshot | null) => void,
) {
  const { run } = useRides();
  const [value, setValue] = useState<{ snapshot: LocationSnapshot; received: number } | null>(null);
  const [gaps, setGaps] = useState<ReturnType<typeof groupGaps> | null>(null);
  const [message, setMessage] = useState('Connecting to your group…');
  const [revision, refresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let active = true,
        generation = revision,
        loading = false;
      let socket: ReturnType<typeof io> | null = null;
      let token = '';
      let route: RouteProgress | null = null;
      let routeLoaded = false;
      let latest: LocationSnapshot | null = null;
      let receivedAt = 0;
      const clear = () => {
        generation++;
        socket?.removeAllListeners();
        socket?.disconnect();
        socket = null;
        setValue(null);
        setGaps(null);
        onSnapshot?.(null);
        latest = null;
        route = null;
        routeLoaded = false;
      };
      const accept = (snapshot: LocationSnapshot) => {
        if (newerSnapshot(latest, snapshot) !== snapshot) return;
        latest = snapshot;
        receivedAt = Date.now();
        onSnapshot?.(snapshot);
        setGaps(groupGaps(snapshot, Date.parse(snapshot.serverTime), route));
        setValue((previous) =>
          newerSnapshot(previous?.snapshot ?? null, snapshot) === snapshot
            ? { snapshot, received: Date.now() }
            : previous,
        );
      };
      const update = async () => {
        if (!active || loading || AppState.currentState !== 'active') return;
        loading = true;
        const version = generation;
        const valid = () => active && version === generation && AppState.currentState === 'active';
        try {
          await run(async (options) => {
            if (!routeLoaded) {
              try {
                const saved = await getRoute(options, id);
                if (!valid()) return;
                route = saved ? new RouteProgress(saved.points, Date.parse(startedAt ?? '')) : null;
                routeLoaded = true;
              } catch {
                /* Keep the location map available; retry route loading on the next refresh. */
              }
            }
            const snapshot = await getLocations(options, id);
            if (!valid()) return;
            accept(snapshot);
            setMessage('Positions refreshed · live updates reconnect automatically');
            if (socket && token === options.accessToken && (socket.connected || socket.active))
              return;
            socket?.removeAllListeners();
            socket?.disconnect();
            token = options.accessToken;
            const channel = io(`${options.apiUrl.replace(/\/$/, '')}/v1/rides`, {
              transports: ['websocket'],
              auth: { token },
              reconnection: true,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 30000,
            });
            socket = channel;
            const receive = (data: unknown) => {
              if (!valid() || socket !== channel) return;
              try {
                accept(parseSnapshot(data, id));
                setMessage('Live group updates');
              } catch {
                clear();
                setMessage('Could not read group positions. Retrying…');
              }
            };
            channel.on('connect', () =>
              channel
                .timeout(10000)
                .emit(
                  'subscribe',
                  { rideId: id, afterSequence: 0 },
                  (error: Error | null, response: { data?: unknown } | undefined) => {
                    if (!valid() || socket !== channel) return;
                    if (error) {
                      clear();
                      setMessage('Live connection interrupted. Retrying…');
                    } else receive(response?.data);
                  },
                ),
            );
            channel.on('location.snapshot', receive);
            channel.on('disconnect', () => {
              if (valid()) {
                clear();
                setMessage('Connection lost. Reconnecting…');
              }
            });
            channel.on('access.revoked', () => {
              if (valid()) {
                clear();
                setMessage('Live access ended. Checking ride access…');
              }
            });
          });
        } catch (error) {
          if (valid()) {
            clear();
            setMessage(error instanceof Error ? error.message : 'Reconnect to see the group.');
          }
        } finally {
          loading = false;
        }
      };
      void update();
      const timer = setInterval(() => {
        setNow(Date.now());
        if (latest)
          setGaps(
            groupGaps(
              latest,
              Date.parse(latest.serverTime) + Math.max(0, Date.now() - receivedAt),
              route,
            ),
          );
        void update();
      }, 5000);
      const app = AppState.addEventListener('change', (state) => {
        if (state !== 'active') {
          clear();
          setMessage('Paused while the app is in the background.');
        } else void update();
      });
      return () => {
        active = false;
        clearInterval(timer);
        app.remove();
        clear();
      };
    }, [id, run, revision, startedAt, enabled, onSnapshot]),
  );
  return {
    gaps,
    snapshot: value?.snapshot ?? null,
    now: value ? Date.parse(value.snapshot.serverTime) + Math.max(0, now - value.received) : now,
    message,
    refresh: () => refresh((value) => value + 1),
  };
}
