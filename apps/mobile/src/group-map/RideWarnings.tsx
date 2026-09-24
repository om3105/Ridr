import { PushControls } from '../notifications/PushControls';
import { useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Notice, styles } from '../auth/components';
import { registerDevice } from '../location/api';
import { trackingDeviceId } from '../location/tracker';
import type { LocationSnapshot } from '../location/types';
import { request } from '../rides/api';
import { useRides } from '../rides/provider';
import { useScreenTask } from '../rides/use-screen-task';
export function RideWarnings({
  snapshot,
  now,
}: {
  snapshot: LocationSnapshot | null;
  now: number;
}) {
  const { run } = useRides(),
    capture = useScreenTask();
  const [acknowledged, setAcknowledged] = useState<string[]>([]),
    [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false),
    working = useRef(false);
  async function acknowledge(id: string) {
    if (!snapshot || working.current) return;
    const deviceId = trackingDeviceId(),
      current = capture();
    if (!deviceId || Platform.OS === 'web') {
      setMessage('Open the signed-in Android or iOS app to acknowledge on this device.');
      return;
    }
    working.current = true;
    setBusy(true);
    setMessage('Acknowledgement pending…');
    try {
      await run(async (options) => {
        await registerDevice(options, deviceId, Platform.OS === 'ios' ? 'ios' : 'android');
        await request(options, {
          path: `/v1/rides/${snapshot.rideId}/alerts/${id}/acknowledgements`,
          method: 'POST',
          deviceId,
          body: {},
          parse: (data) => {
            if (
              !data ||
              typeof data !== 'object' ||
              !('acknowledged' in data) ||
              data.acknowledged !== true
            )
              throw new Error('Acknowledgement was not confirmed.');
            return true;
          },
        });
      });
      if (current()) {
        setAcknowledged((ids) => [...ids, id]);
        setMessage('Acknowledged on this device.');
      }
    } catch (error) {
      if (current())
        setMessage(error instanceof Error ? error.message : 'Acknowledgement failed. Retry.');
    } finally {
      working.current = false;
      if (current()) setBusy(false);
    }
  }
  const warnings =
    snapshot?.alerts?.filter(
      (warning) =>
        now - Date.parse(warning.createdAt) <= 120000 &&
        now - Date.parse(warning.position.recordedAt) <= 30000,
    ) ?? [];
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.cardTitle}>Group warnings</Text>
      <Text style={styles.detail}>
        Live warnings appear while this map is open. Background notifications require separate setup
        below.
      </Text>
      {snapshot?.alertSettings && (
        <Text style={styles.detail}>
          Group threshold: {snapshot.alertSettings.stragglerDistanceM} m · Your battery threshold:{' '}
          {snapshot.alertSettings.batteryThreshold}%
        </Text>
      )}
      {!warnings.length && (
        <Notice>
          {snapshot?.alerts
            ? 'No current warnings from available readings.'
            : 'Waiting for the warning service.'}
        </Notice>
      )}
      {warnings.map((warning) => (
        <View key={warning.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {snapshot?.members.find((member) => member.id === warning.memberId)?.displayName ??
              'Ride member'}{' '}
            · {warning.kind === 'battery' ? 'Low battery' : 'Behind the group'}
          </Text>
          <Text style={styles.detail}>
            {warning.kind === 'battery'
              ? `${warning.value}% battery when warned. Tracking may stop if the phone runs out of power. This is not an SOS.`
              : `${Math.round(warning.value)} m behind the route-progress median when warned.`}
          </Text>
          <Text style={styles.detail}>
            Latest shared position: {warning.position.lat.toFixed(5)},{' '}
            {warning.position.lon.toFixed(5)} ·{' '}
            {new Date(warning.position.recordedAt).toLocaleTimeString()}
          </Text>
          <Button
            label={
              acknowledged.includes(warning.id)
                ? 'Acknowledged on this device'
                : 'Acknowledge on this device'
            }
            secondary
            disabled={busy || acknowledged.includes(warning.id)}
            onPress={() => {
              void acknowledge(warning.id);
            }}
          />
        </View>
      ))}
      <Notice>{message}</Notice>
      <PushControls />
    </View>
  );
}
