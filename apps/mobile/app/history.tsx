import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Notice, Page, styles } from '../src/auth/components';
import { useAuth } from '../src/auth/provider';
import { getRideHistory, type HistoryItem } from '../src/history/api';
import { RideError } from '../src/rides/api';
import { RideAccess, useRides } from '../src/rides/provider';
import { useScreenTask } from '../src/rides/use-screen-task';
import SponsoredCard from '../src/sponsored/SponsoredCard';
import { PrimaryNavigation } from '../src/navigation/PrimaryNavigation';

export default function HistoryScreen() {
  const auth = useAuth();
  return (
    <RideAccess>
      <HistoryList key={auth.profile?.id} />
    </RideAccess>
  );
}

function HistoryList() {
  const { run } = useRides();
  const capture = useScreenTask();
  const sequence = useRef(0);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(
    async (next?: string) => {
      const current = capture();
      const request = ++sequence.current;
      setBusy(true);
      setMessage('');
      try {
        const page = await run((options) => getRideHistory(options, { cursor: next }));
        if (!current() || request !== sequence.current) return;
        setItems((previous) =>
          next
            ? [...new Map([...previous, ...page.items].map((item) => [item.rideId, item])).values()]
            : page.items,
        );
        setCursor(page.nextCursor);
        setLoaded(true);
      } catch (error) {
        if (!current() || request !== sequence.current) return;
        setItems([]);
        setCursor(null);
        setLoaded(false);
        setMessage(
          error instanceof RideError && error.code === 'unavailable'
            ? 'Your ride history is unavailable. Check your connection and refresh.'
            : error instanceof Error
              ? error.message
              : 'Your ride history is unavailable. Refresh to try again.',
        );
      } finally {
        if (current() && request === sequence.current) setBusy(false);
      }
    },
    [capture, run],
  );
  useFocusEffect(useCallback(() => void load(), [load]));
  return (
    <Page footer={<PrimaryNavigation active="history" />}>
      <Text accessibilityRole="header" style={styles.title}>
        Your rides
      </Text>
      <Text style={styles.detail}>
        Completed rides you joined in the last 90 days. Each distance and pace is calculated from
        your own recorded location.
      </Text>
      <SponsoredCard placement="history" />
      {!!message && <Notice>{message}</Notice>}
      {loaded && items.length === 0 && (
        <Notice>No completed rides are available in your last 90 days.</Notice>
      )}
      {items.length > 0 && <Text style={styles.eyebrow}>COMPLETED RIDES</Text>}
      {items.map((item) => (
        <View key={item.rideId} style={styles.card}>
          <Text style={styles.cardTitle}>{item.rideName}</Text>
          <Text style={styles.detail}>Ended {new Date(item.endedAt).toLocaleString()}</Text>
          <Text style={styles.detail}>
            {(item.recordedDistanceM / 1000).toFixed(2)} km recorded ·{' '}
            {Math.floor(item.participationDurationSeconds / 60)} min participating
          </Text>
          <Text style={styles.detail}>
            {item.elapsedPaceMinPerKm === null
              ? 'Pace unavailable without recorded distance'
              : `${item.elapsedPaceMinPerKm.toFixed(2)} min/km elapsed pace`}
          </Text>
          <Link href={{ pathname: '/summary', params: { id: item.rideId } }} style={styles.link}>
            Open your summary →
          </Link>
        </View>
      ))}
      {cursor && (
        <Button label="Load more rides" secondary busy={busy} onPress={() => void load(cursor)} />
      )}
      <Button
        label={busy ? 'Loading history…' : 'Refresh history'}
        secondary
        busy={busy}
        onPress={() => void load()}
      />
    </Page>
  );
}
