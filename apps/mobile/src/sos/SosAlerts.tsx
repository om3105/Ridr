import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useAuth } from '../auth/provider';
import { styles } from '../auth/components';
import { registerDevice } from '../location/api';
import { useRides } from '../rides/provider';
import { acknowledgeSos, listSos, type SosView } from './api';
import { sosDeviceId } from './storage';

export function SosAlerts({ rideId }: { rideId: string }) {
  const owner = useAuth().profile?.id ?? '';
  const { run } = useRides();
  const [alerts, setAlerts] = useState<SosView[]>([]);
  const reading = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const refresh = async () => {
        if (!owner || reading.current) return;
        reading.current = true;
        try {
          const items = await run((options) => listSos(options, rideId));
          if (!active) return;
          setAlerts(items.filter((item) => !item.resolution).slice(0, 3));
          const deviceId = await sosDeviceId(owner);
          for (const item of items) {
            if (
              !active ||
              item.deviceId === deviceId ||
              item.deviceReceipts.some((receipt) => receipt.deviceId === deviceId)
            )
              continue;
            try {
              await run(async (options) => {
                await registerDevice(options, deviceId, Platform.OS === 'ios' ? 'ios' : 'android');
                return acknowledgeSos(options, rideId, item.id, deviceId);
              });
            } catch {
              /* Retry on the next refresh. */
            }
          }
        } catch {
          /* Keep the last confirmed alerts through a connection failure. */
        } finally {
          reading.current = false;
        }
      };
      void refresh();
      const timer = setInterval(() => {
        void refresh();
      }, 3000);
      return () => {
        active = false;
        clearInterval(timer);
        setAlerts([]);
      };
    }, [owner, rideId, run]),
  );
  if (!alerts.length) return null;
  return (
    <View style={styles.card} accessibilityLiveRegion="assertive">
      <Text style={styles.cardTitle}>Active ride SOS</Text>
      {alerts.map((item) => (
        <Text key={item.id} style={styles.detail}>
          {item.reporterName} requested help
          {item.pairSnapshot
            ? ` · paired with ${item.pairSnapshot.riderMemberId === item.reporterMemberId ? item.pairSnapshot.pillionName : item.pairSnapshot.riderName}`
            : ''}
          .
        </Text>
      ))}
      <Link href={{ pathname: '/ride', params: { id: rideId, view: 'sos' } }} style={styles.link}>
        Open SOS details →
      </Link>
    </View>
  );
}
