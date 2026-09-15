import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { Button, Field, Notice, Page, styles } from '../src/auth/components';
import { validateDisplayName } from '../src/auth/validation';
import { createRide, RideError } from '../src/rides/api';
import { Choices, transportNames } from '../src/rides/components';
import type { Transport } from '../src/rides/models';
import { RideAccess, useRides } from '../src/rides/provider';
import { useScreenTask } from '../src/rides/use-screen-task';

export default function CreateScreen() {
  return (
    <RideAccess>
      <CreateForm />
    </RideAccess>
  );
}
function CreateForm() {
  const { run, rememberInvitation } = useRides();
  const capture = useScreenTask();
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<Transport>('motorcycle');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const operation = useRef<{ name: string; transport: Transport; idempotencyKey: string } | null>(
    null,
  );
  async function submit() {
    if (busy) return;
    const current = capture();
    if (validateDisplayName(name)) {
      setMessage('Enter a ride name between 1 and 80 characters, without markup or line breaks.');
      return;
    }
    operation.current ??= { name: name.trim(), transport, idempotencyKey: randomUUID() };
    setBusy(true);
    setUncertain(true);
    setMessage('');
    try {
      const result = await run((options) => createRide(options, operation.current!));
      if (!current()) return;
      rememberInvitation(result.ride.id, result.invite);
      operation.current = null;
      router.replace({ pathname: '/ride', params: { id: result.ride.id } });
    } catch (error) {
      if (!current()) return;
      const unconfirmed = error instanceof RideError && error.unconfirmed;
      setUncertain(unconfirmed);
      if (!unconfirmed) operation.current = null;
      setMessage(
        error instanceof Error ? error.message : 'Your ride could not be created. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Text style={styles.eyebrow}>BRING YOUR GROUP TOGETHER</Text>
      <Text accessibilityRole="header" style={styles.title}>
        Create a ride.
      </Text>
      <Field
        label="Ride name"
        value={name}
        onChangeText={setName}
        placeholder="Sunday Loop"
        editable={!busy && !uncertain}
        autoCapitalize="sentences"
      />
      <Choices<Transport>
        label="Ride type"
        options={Object.entries(transportNames).map(([value, label]) => ({
          value: value as Transport,
          label,
        }))}
        selected={transport}
        onChange={setTransport}
        disabled={busy || uncertain}
      />
      <Text style={styles.detail}>
        You’ll be the leader and a Rider. Invite your people from the lobby.
      </Text>
      <Notice>Creating a ride keeps location sharing off.</Notice>
      {!!message && <Notice>{message}</Notice>}
      {uncertain && (
        <Text style={styles.detail}>
          The result is not confirmed. Retry this same request to recover it safely.
        </Text>
      )}
      <Button
        label={uncertain ? 'Retry create ride' : 'Create ride'}
        busy={busy}
        onPress={() => {
          void submit();
        }}
      />
    </Page>
  );
}
