import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { Button, Notice, Page, styles } from '../src/auth/components';
import GroupMap from '../src/group-map/GroupMap';
import { RideAccess, useRides } from '../src/rides/provider';
import { RideError } from '../src/rides/api';
import { getRideSummary, summaryTraceGeometry, type RideSummary } from '../src/summary/api';
import PhotoSection from '../src/photos/PhotoSection';

export default function SummaryScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <RideAccess>
      <Summary rideId={typeof id === 'string' ? id : ''} />
    </RideAccess>
  );
}

const minutes = (seconds: number) =>
  `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
const reason = (value: string) =>
  ({
    missing_samples: 'No recorded samples',
    poor_accuracy: 'Poor GPS accuracy',
    implausible_jump: 'Implausible GPS jump',
    sharing_change: 'Sharing restarted',
    sharing_off: 'Location sharing off',
  })[value as 'missing_samples'] ?? 'Tracking interrupted';

function Summary({ rideId }: { rideId: string }) {
  const { run } = useRides();
  const [summary, setSummary] = useState<RideSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading your ride summary…');
  const refresh = useCallback(async () => {
    if (!rideId) return;
    setBusy(true);
    try {
      const result = await run((options) => getRideSummary(options, rideId));
      setSummary(result);
      setMessage('Late eligible uploads may update this summary. Refresh to check again.');
    } catch (error) {
      setSummary(null);
      setMessage(
        error instanceof RideError && error.code === 'not_found'
          ? 'This ride summary was removed or is unavailable.'
          : error instanceof Error
            ? error.message
            : 'Your ride summary is unavailable.',
      );
    } finally {
      setBusy(false);
    }
  }, [rideId, run]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const app = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      return () => app.remove();
    }, [refresh]),
  );
  return (
    <Page>
      <Text style={styles.eyebrow}>COMPLETED RIDE · YOUR RECORD</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {summary?.rideName ?? 'Ride summary'}
      </Text>
      <Notice>{message}</Notice>
      {summary && (
        <>
          <Text style={styles.detail}>
            Ended {new Date(summary.endedAt).toLocaleString()} · Updated{' '}
            {new Date(summary.updatedAt).toLocaleString()}
          </Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your recorded ride</Text>
            <Text style={styles.detail}>
              Recorded distance: {(summary.recordedDistanceM / 1000).toFixed(2)} km
            </Text>
            <Text style={styles.detail}>
              Participation time, including stops: {minutes(summary.participationDurationSeconds)}
            </Text>
            <Text style={styles.detail}>
              Elapsed pace:{' '}
              {summary.elapsedPaceMinPerKm === null
                ? 'Unavailable (no recorded distance)'
                : `${summary.elapsedPaceMinPerKm.toFixed(2)} min/km`}
            </Text>
            <Text style={styles.detail}>
              Average speed:{' '}
              {summary.averageSpeedKmh === null
                ? 'Unavailable'
                : `${summary.averageSpeedKmh.toFixed(2)} km/h`}
            </Text>
            <Text style={styles.detail}>
              {summary.sampleCount} retained samples · {summary.excludedSamples} excluded for
              quality or timing
            </Text>
          </View>
          <Text style={styles.cardTitle}>Your recorded route</Text>
          {summary.trace.shownPoints ? (
            <GroupMap
              data={{ type: 'FeatureCollection', features: [] }}
              trail={summaryTraceGeometry(summary)}
            />
          ) : (
            <Notice>No recorded route is available.</Notice>
          )}
          <Text style={styles.detail}>
            {summary.trace.previewComplete
              ? 'Lines join only continuous, accurate observations. Gaps are not connected.'
              : `Map preview shows the first ${summary.trace.shownPoints} accurate observations. Distance and pace use the full retained record.`}
          </Text>
          <Text style={styles.cardTitle}>Tracking gaps</Text>
          <Text style={styles.detail}>
            {summary.gapCount} interrupted or unshared spans. Missing travel is never estimated.
          </Text>
          {summary.gaps.slice(0, 8).map((gap, index) => (
            <Text key={`${gap.from}-${index}`} style={styles.detail}>
              {reason(gap.reason)} · {new Date(gap.from).toLocaleTimeString()}–
              {new Date(gap.to).toLocaleTimeString()}
            </Text>
          ))}
          {summary.gapCount > 8 && <Text style={styles.detail}>Showing the first 8 gaps.</Text>}
          <Text style={styles.cardTitle}>Ride changes</Text>
          {summary.memberEvents.length ? (
            summary.memberEvents.map((event, index) => (
              <Text key={`${event.memberId}-${event.at}-${index}`} style={styles.detail}>
                {event.displayName} · {event.kind === 'left' ? 'left the ride' : 'stopped sharing'}{' '}
                · {new Date(event.at).toLocaleString()}
              </Text>
            ))
          ) : (
            <Text style={styles.detail}>No recorded departures or sharing stops.</Text>
          )}
          {!summary.memberEventsComplete && <Notice>Showing the first 200 ride changes.</Notice>}
          <Text style={styles.detail}>
            This summary is available until {new Date(summary.expiresAt).toLocaleDateString()}.
          </Text>
          <PhotoSection key={`${summary.rideId}-${summary.memberId}`} summary={summary} />
        </>
      )}
      <Button label="Refresh summary" secondary busy={busy} onPress={() => void refresh()} />
      <Link href="/history" style={styles.link}>
        Back to history →
      </Link>
      <Link
        href={{ pathname: '/ride', params: { id: rideId, view: 'controls' } }}
        style={styles.link}
      >
        Back to ride →
      </Link>
    </Page>
  );
}
