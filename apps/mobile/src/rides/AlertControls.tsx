import { randomUUID } from 'expo-crypto';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Notice, styles } from '../auth/components';
import { request, RideError, type RideClientOptions } from './api';
import type { RideManagement } from './models';
import { useRides } from './provider';
import { useMotionCheck } from './use-motion-check';
import { useScreenTask } from './use-screen-task';

export function AlertControls({
  management,
  onChanged,
}: {
  management: RideManagement;
  onChanged(): void;
}) {
  const { run } = useRides(),
    motion = useMotionCheck(),
    capture = useScreenTask();
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<((options: RideClientOptions) => Promise<unknown>) | null>(null);
  const working = useRef(false);
  async function execute() {
    if (working.current || !pending.current) return;
    const current = capture();
    working.current = true;
    setBusy(true);
    try {
      await run(pending.current);
      pending.current = null;
      if (current()) {
        setMessage('Warning setting saved. A new battery setting starts with the next readings.');
        onChanged();
      }
    } catch (error) {
      if (error instanceof RideError && !error.unconfirmed) pending.current = null;
      if (current())
        setMessage(error instanceof Error ? error.message : 'Save unconfirmed. Retry the request.');
    } finally {
      working.current = false;
      if (current()) setBusy(false);
    }
  }
  function change(kind: 'battery' | 'straggler', value: number) {
    try {
      const body = { kind, value, ...(kind === 'straggler' ? motion.latest() : {}) },
        key = randomUUID();
      pending.current = (options) =>
        request(options, {
          path: `/v1/rides/${management.ride.id}/alert-settings`,
          method: 'PUT',
          body,
          idempotencyKey: key,
          revision: kind === 'straggler' ? management.ride.revision : undefined,
          parse: (data) => {
            if (!data || typeof data !== 'object' || !('value' in data) || data.value !== value)
              throw new Error('Setting confirmation was invalid. Retry.');
            return data;
          },
        });
      void execute();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Check that you are stopped.');
    }
  }
  if (management.ride.state !== 'active' || management.membership.leftAt) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Ride warnings</Text>
      <Text style={styles.detail}>
        Low battery warns the group about possible tracking loss. It is not an SOS. Choose your
        threshold:
      </Text>
      {[10, 20, 30].map((value) => (
        <Button
          key={value}
          label={`${value}% battery`}
          secondary
          disabled={busy || !!pending.current}
          onPress={() => change('battery', value)}
        />
      ))}
      {management.membership.role === 'leader' && (
        <>
          <Text style={styles.detail}>
            Behind-group threshold: {management.ride.settings.stragglerDistanceM} m. A warning needs
            30 seconds of reliable route positions.
          </Text>
          <Button
            label="Check that I am stopped"
            busy={motion.checking}
            onPress={() => {
              void motion.check();
            }}
          />
          <Notice>{motion.message}</Notice>
          {[200, 500, 1000, 2000].map((value) => (
            <Button
              key={value}
              label={`${value} m behind`}
              secondary
              disabled={!motion.ready || busy || !!pending.current}
              onPress={() => change('straggler', value)}
            />
          ))}
        </>
      )}
      <Notice>{message}</Notice>
      {!!pending.current && (
        <Button
          label="Retry unconfirmed setting"
          busy={busy}
          onPress={() => {
            void execute();
          }}
        />
      )}
    </View>
  );
}
