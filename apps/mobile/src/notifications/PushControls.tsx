import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Notice, styles } from '../auth/components';
import { trackingDeviceId } from '../location/tracker';
import { request } from '../rides/api';
import { useRides } from '../rides/provider';
import { useScreenTask } from '../rides/use-screen-task';
import { enableWarningPush, disableWarningPush } from './push';
export function PushControls() {
  const { run } = useRides(),
    capture = useScreenTask();
  const [message, setMessage] = useState(
      'Background notifications require permission and configured Android/iOS push credentials. Delivery can be delayed or suppressed by your phone.',
    ),
    [busy, setBusy] = useState(false);
  const working = useRef(false);
  async function change(action: 'enable' | 'disable' | 'status') {
    if (working.current) return;
    const id = trackingDeviceId(),
      current = capture();
    if (!id) {
      setMessage('Sign in to the rebuilt Android or iOS app to manage notifications.');
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const result = await run(async (options) => {
        if (action === 'status')
          return request(options, {
            path: `/v1/me/devices/${id}/push`,
            parse: (value) => {
              if (
                !value ||
                typeof value !== 'object' ||
                !('configured' in value) ||
                typeof value.configured !== 'boolean' ||
                !('registered' in value) ||
                typeof value.registered !== 'boolean' ||
                !('deliveries' in value) ||
                !Array.isArray(value.deliveries)
              )
                throw new Error('Notification status unavailable.');
              const counts = value.deliveries.map((row) => {
                if (
                  !row ||
                  typeof row !== 'object' ||
                  !['pending', 'accepted', 'delivered', 'failed', 'unknown', 'suppressed'].includes(
                    row.state,
                  ) ||
                  !Number.isSafeInteger(row.count) ||
                  row.count < 0
                )
                  throw new Error('Notification status unavailable.');
                const label =
                  row.state === 'accepted'
                    ? 'accepted by Expo'
                    : row.state === 'delivered'
                      ? 'handed to Android/iOS provider'
                      : row.state;
                return `${label}: ${row.count}`;
              });
              return !value.configured
                ? 'Background notifications are not configured on the server.'
                : `${value.registered ? 'Device token registered' : 'Device not registered'}. Last 24 hours: ${counts.join(', ') || 'no push attempts'}. Provider acceptance does not confirm that you saw a warning.`;
            },
          });
        const registration = await (action === 'enable' ? enableWarningPush : disableWarningPush)(
          options,
          id,
        );
        return registration.enabled
          ? `Registered until ${new Date(registration.expiresAt!).toLocaleTimeString()}. Registration renews while signed-in tracking is active. This does not confirm delivery; use Check delivery status.`
          : 'Background notifications disabled on this device.';
      });
      if (current()) setMessage(result);
    } catch (error) {
      if (current())
        setMessage(
          error instanceof Error ? error.message : 'Notification change unconfirmed. Retry.',
        );
    } finally {
      working.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Background notifications</Text>
      <Notice>{message}</Notice>
      <Button
        label="Enable on this device"
        busy={busy}
        onPress={() => {
          void change('enable');
        }}
      />
      <Button
        label="Disable on this device"
        secondary
        disabled={busy}
        onPress={() => {
          void change('disable');
        }}
      />
      <Button
        label="Check delivery status"
        secondary
        disabled={busy}
        onPress={() => {
          void change('status');
        }}
      />
    </View>
  );
}
