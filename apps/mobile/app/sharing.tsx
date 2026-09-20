import { useCallback, useEffect, useState } from 'react';
import { Link, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { AppState, Switch, Text, View } from 'react-native';
import { io } from 'socket.io-client';
import { Button, Notice, Page, styles } from '../src/auth/components';
import { RideAccess, useRides } from '../src/rides/provider';
import { getRideManagement } from '../src/rides/api';
import type { RideManagement } from '../src/rides/models';
import { getLocations, parseSnapshot } from '../src/location/api';
import { startTracking, stopTracking, subscribeTracking } from '../src/location/tracker';
import type { LocationSnapshot, TrackingStatus } from '../src/location/types';

export default function SharingScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return (
    <RideAccess>
      <Sharing key={String(id)} id={typeof id === 'string' ? id : ''} />
    </RideAccess>
  );
}
function Sharing({ id }: { id: string }) {
  const { run } = useRides();
  const [management, setManagement] = useState<RideManagement | null>(null);
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [snapshot, setSnapshot] = useState<LocationSnapshot | null>(null);
  const [background, setBackground] = useState(false);
  const usingBackground = status?.sharing ? (status.background ?? false) : background;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => subscribeTracking(setStatus), []);
  useFocusEffect(
    useCallback(() => {
      let active = true,
        loading = false;
      let socket: ReturnType<typeof io> | null = null;
      let socketToken = '';
      const update = async () => {
        if (loading || AppState.currentState !== 'active') return;
        loading = true;
        try {
          const result = await run((options) => getRideManagement(options, id));
          if (!active) return;
          setManagement(result);
          if (result.ride.state !== 'active' || result.membership.leftAt) {
            setSnapshot(null);
            socket?.disconnect();
            setConnected(false);
            await stopTracking();
            return;
          }
          const fresh = await run((options) => getLocations(options, id));
          if (!active) return;
          setSnapshot(fresh);
          await run(async (options) => {
            if (!active) return;
            if (socket && socketToken === options.accessToken) return;
            socket?.disconnect();
            socketToken = options.accessToken;
            socket = io(`${options.apiUrl.replace(/\/$/, '')}/v1/rides`, {
              transports: ['websocket'],
              auth: { token: options.accessToken },
              reconnection: true,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 30000,
            });
            socket.on('connect', () => {
              socket
                ?.timeout(10000)
                .emit(
                  'subscribe',
                  { rideId: id, afterSequence: 0 },
                  (error: Error | null, response: unknown) => {
                    if (!active) return;
                    try {
                      if (error) throw error;
                      const data = (response as { data?: unknown }).data;
                      setSnapshot(parseSnapshot(data));
                      setConnected(true);
                    } catch {
                      setSnapshot(null);
                      setConnected(false);
                      socket?.disconnect();
                    }
                  },
                );
            });
            socket.on('location.snapshot', (data: unknown) => {
              if (active) {
                try {
                  setSnapshot(parseSnapshot(data));
                  setConnected(true);
                } catch {
                  setSnapshot(null);
                  setConnected(false);
                }
              }
            });
            socket.on('disconnect', () => {
              if (active) {
                setSnapshot(null);
                setConnected(false);
              }
            });
            socket.on('access.revoked', () => {
              if (active) {
                setSnapshot(null);
                setConnected(false);
              }
            });
          });
        } catch (error) {
          if (active) {
            setSnapshot(null);
            setConnected(false);
            setMessage(error instanceof Error ? error.message : 'Reconnect to see live locations.');
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
          socket?.disconnect();
          socket = null;
          setSnapshot(null);
          setConnected(false);
        } else void update();
      });
      return () => {
        active = false;
        clearInterval(timer);
        app.remove();
        socket?.disconnect();
      };
    }, [id, run]),
  );
  async function start() {
    if (!management) return;
    setBusy(true);
    setMessage('');
    try {
      await startTracking(management, background);
      setManagement(await run((options) => getRideManagement(options, id)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sharing could not start.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Text style={styles.eyebrow}>LIVE LOCATION</Text>
      <Text style={styles.title}>Share your ride, on your terms.</Text>
      <Text style={styles.detail}>
        Your timestamped position, GPS accuracy, speed and direction are visible to active members
        of this ride. Joining a ride never turns this on automatically.
      </Text>
      {!!message && <Notice>{message}</Notice>}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {status?.sharing ? 'Location sharing is on' : 'Location sharing is off'}
        </Text>
        <Notice>{status?.message ?? 'Preparing encrypted location storage…'}</Notice>
        <Text style={styles.detail}>
          Target interval: {management?.ride.settings.broadcastIntervalSeconds ?? 5} seconds. Your
          phone may delay background updates. Positions older than 30 seconds are stale.
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Text style={[styles.label, { flex: 1 }]}>Keep sharing when the screen is locked</Text>
          <Switch
            accessibilityLabel="Allow background location sharing"
            value={usingBackground}
            disabled={busy || status?.sharing}
            onValueChange={setBackground}
          />
        </View>
        <Text style={styles.detail}>
          {usingBackground
            ? 'Requires background location permission. A phone indicator or notification stays visible.'
            : 'Foreground only. Sharing stops when you leave the app.'}{' '}
          If the operating system ends Ridr, reopen it and explicitly enable sharing again.
        </Text>
        <Button
          label="I agree — start sharing"
          busy={busy}
          disabled={
            !management ||
            management.ride.state !== 'active' ||
            !!management.membership.leftAt ||
            status?.sharing ||
            status?.pendingStop
          }
          onPress={() => {
            void start();
          }}
        />
        <Button
          label="Stop sharing now"
          secondary
          onPress={() => {
            void stopTracking().catch(() =>
              setMessage(
                'Collection is off. Disable Ridr location access in Settings if cleanup failed.',
              ),
            );
          }}
        />
        <Text style={styles.detail}>
          {status?.queued ?? 0} encrypted samples waiting (kept for up to 24 hours) ·{' '}
          {status?.pendingStop ? 'Stop confirmation pending' : 'No pending stop'}
        </Text>
        <Text style={styles.detail}>
          Last capture:{' '}
          {status?.lastCapturedAt ? new Date(status.lastCapturedAt).toLocaleTimeString() : 'none'}
          {status?.lastCapturedAt && now - Date.parse(status.lastCapturedAt) > 30000
            ? ' · stale'
            : ''}
        </Text>
        <Text style={styles.detail}>
          Last acknowledgement:{' '}
          {status?.lastAckAt ? new Date(status.lastAckAt).toLocaleTimeString() : 'none'}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Live delivery status</Text>
        <Text style={styles.detail}>
          {connected ? 'Connected to live updates' : 'Using periodic refresh when connected'} ·{' '}
          {snapshot?.items.length ?? 0} members with shared positions
        </Text>
        {snapshot?.items.map((item) => (
          <Text key={item.memberId} style={styles.detail}>
            {item.memberId === management?.membership.id
              ? 'You'
              : `Member ${item.memberId.slice(0, 6)}`}{' '}
            · {now - Date.parse(item.position.recordedAt) > 30000 ? 'stale' : item.freshness} · ±
            {Math.round(item.position.accuracyM)} m ·{' '}
            {new Date(item.position.recordedAt).toLocaleTimeString()}
          </Text>
        ))}
      </View>
      <Link href={{ pathname: '/ride', params: { id } }} style={styles.link}>
        Back to your ride →
      </Link>
    </Page>
  );
}
