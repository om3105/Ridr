import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Notice, Page, styles } from '../src/auth/components';
import { listRides } from '../src/rides/api';
import { roleNames, transportNames } from '../src/rides/components';
import type { RideMembership } from '../src/rides/models';
import { RideAccess, useRides } from '../src/rides/provider';
import { useScreenTask } from '../src/rides/use-screen-task';

export default function RidesScreen() {
  return (
    <RideAccess>
      <RideList />
    </RideAccess>
  );
}
function RideList() {
  const { run } = useRides();
  const capture = useScreenTask();
  const [items, setItems] = useState<RideMembership[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const sequence = useRef(0);
  const load = useCallback(
    async (next?: string) => {
      const current = capture();
      const request = ++sequence.current;
      setBusy(true);
      setMessage('');
      try {
        const result = await run((options) =>
          listRides(options, { limit: 50, ...(next ? { cursor: next } : {}) }),
        );
        if (!current() || request !== sequence.current) return;
        setItems((previous) =>
          next
            ? [
                ...new Map(
                  [...previous, ...result.items].map((item) => [item.ride.id, item]),
                ).values(),
              ]
            : result.items,
        );
        setCursor(result.nextCursor);
        setLoaded(true);
      } catch (error) {
        if (current() && request === sequence.current)
          setMessage(error instanceof Error ? error.message : 'Your rides could not be loaded.');
      } finally {
        if (current() && request === sequence.current) setBusy(false);
      }
    },
    [run, capture],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  return (
    <Page>
      <Text accessibilityRole="header" style={styles.title}>
        Your rides.
      </Text>
      <Text style={styles.detail}>Create a group, join your people, or return to a ride.</Text>
      <Link href="/create" style={styles.link}>
        Create a ride →
      </Link>
      <Link href="/join" style={styles.link}>
        Join with code, link or QR →
      </Link>
      {!!message && <Notice>{message}</Notice>}
      {loaded && items.length === 0 && (
        <Notice>Your rides will appear here after you create or join one.</Notice>
      )}
      {items.map(({ ride, membership }) => (
        <View key={ride.id} style={styles.card}>
          <Text style={styles.cardTitle}>{ride.name}</Text>
          <Text style={styles.detail}>
            {transportNames[ride.transport]} ·{' '}
            {ride.state === 'lobby' ? 'Lobby' : ride.state === 'active' ? 'Active ride' : 'Ended'} ·{' '}
            {membership.role === 'leader' ? 'Leader' : roleNames[membership.physicalRole]}
          </Text>
          <Link href={{ pathname: '/ride', params: { id: ride.id } }} style={styles.link}>
            Open ride →
          </Link>
        </View>
      ))}
      {cursor && (
        <Button
          label="Load more rides"
          secondary
          busy={busy}
          onPress={() => {
            void load(cursor);
          }}
        />
      )}
      <Button
        label={busy ? 'Loading rides…' : 'Refresh rides'}
        secondary
        busy={busy}
        onPress={() => {
          void load();
        }}
      />
    </Page>
  );
}
