import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { useRides } from '../rides/provider';
import { getLocations, parseSnapshot } from '../location/api';
import type { LocationSnapshot } from '../location/types';
import { newerSnapshot } from './model';

export function useGroupLocations(id: string) {
  const { run } = useRides();
  const [value, setValue] = useState<{ snapshot: LocationSnapshot; received: number } | null>(null);
  const [message, setMessage] = useState('Connecting to your group…');
  const [revision, refresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  useFocusEffect(
    useCallback(() => {
      let active = true,
        generation = revision,
        loading = false;
      let socket: ReturnType<typeof io> | null = null;
      let token = '';
      const clear = () => {
        generation++;
        socket?.removeAllListeners();
        socket?.disconnect();
        socket = null;
        setValue(null);
      };
      const accept = (snapshot: LocationSnapshot) => {
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
    }, [id, run, revision]),
  );
  return {
    snapshot: value?.snapshot ?? null,
    now: value ? Date.parse(value.snapshot.serverTime) + Math.max(0, now - value.received) : now,
    message,
    refresh: () => refresh((value) => value + 1),
  };
}
