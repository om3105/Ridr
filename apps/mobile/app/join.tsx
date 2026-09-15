import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, Notice, Page, styles } from '../src/auth/components';
import { joinRide, previewInvitation, RideError } from '../src/rides/api';
import { Choices, roleNames, transportNames } from '../src/rides/components';
import { InviteScanner } from '../src/rides/InviteScanner';
import { parseInvitation, type InvitationCredential } from '../src/rides/invitations';
import type { InvitationPreview, PhysicalRole } from '../src/rides/models';
import {
  clearIncomingInvitation,
  invitationVersion,
  peekInvitation,
  subscribeInvitation,
} from '../src/rides/private-session';
import { RideAccess, useRides } from '../src/rides/provider';
import { useScreenTask } from '../src/rides/use-screen-task';

export default function JoinScreen() {
  return (
    <RideAccess>
      <JoinForm />
    </RideAccess>
  );
}
function JoinForm() {
  const { run } = useRides();
  const capture = useScreenTask();
  const incomingVersion = useSyncExternalStore(
    subscribeInvitation,
    invitationVersion,
    invitationVersion,
  );
  const [input, setInput] = useState('');
  const [credential, setCredential] = useState<InvitationCredential | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [role, setRole] = useState<PhysicalRole | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const sequence = useRef(0);
  const operation = useRef<{
    rideId: string;
    credential: InvitationCredential;
    physicalRole: PhysicalRole;
    idempotencyKey: string;
  } | null>(null);
  const inspect = useCallback(
    async (candidate: InvitationCredential) => {
      const current = capture();
      const request = ++sequence.current;
      setBusy(true);
      setMessage('');
      setPreview(null);
      setRole(null);
      setInput('');
      setCredential(candidate);
      try {
        const result = await run((options) => previewInvitation(options, candidate));
        if (current() && request === sequence.current) setPreview(result);
      } catch (error) {
        if (current() && request === sequence.current)
          setMessage(
            error instanceof Error ? error.message : 'This invitation could not be checked.',
          );
      } finally {
        if (request === sequence.current) setBusy(false);
      }
    },
    [run, capture],
  );
  useFocusEffect(
    useCallback(() => {
      if (joining || uncertain || invitationVersion() !== incomingVersion) return;
      const incoming = peekInvitation();
      if (incoming.credential) {
        clearIncomingInvitation();
        void inspect(incoming.credential);
      } else if (incoming.invalid) {
        clearIncomingInvitation();
        sequence.current++;
        setBusy(false);
        setCredential(null);
        setPreview(null);
        setRole(null);
        setInput('');
        setMessage('This invite link is invalid. Ask the leader for a new code or Ridr link.');
      }
    }, [incomingVersion, inspect, joining, uncertain]),
  );
  function previewInput(value: string) {
    if (joining || uncertain || busy) return;
    try {
      void inspect(parseInvitation(value));
    } catch {
      setMessage('Enter the 10-character ride code or a valid Ridr invite link.');
      setPreview(null);
      setCredential(null);
    }
  }
  async function join() {
    if (!preview || !credential || !role || joining) return;
    const current = capture();
    operation.current ??= {
      rideId: preview.rideId,
      credential,
      physicalRole: role,
      idempotencyKey: randomUUID(),
    };
    setJoining(true);
    setUncertain(true);
    setMessage('');
    try {
      const result = await run((options) => joinRide(options, operation.current!));
      if (!current()) return;
      setCredential(null);
      setPreview(null);
      operation.current = null;
      router.replace({ pathname: '/ride', params: { id: result.ride.id } });
    } catch (error) {
      if (!current()) return;
      const unconfirmed = error instanceof RideError && error.unconfirmed;
      setUncertain(unconfirmed);
      if (!unconfirmed) operation.current = null;
      setMessage(
        error instanceof Error ? error.message : 'Your membership could not be confirmed.',
      );
    } finally {
      setJoining(false);
    }
  }
  return (
    <Page>
      <Text style={styles.eyebrow}>FIND YOUR GROUP</Text>
      <Text accessibilityRole="header" style={styles.title}>
        Join a ride.
      </Text>
      <Field
        label="Ride code or invite link"
        value={input}
        onChangeText={(value) => {
          setInput(value);
          setPreview(null);
          setCredential(null);
          setRole(null);
          setMessage('');
        }}
        placeholder="Enter code or paste Ridr link"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="none"
        editable={!busy && !joining && !uncertain}
      />
      <Button
        label={busy ? 'Checking invitation…' : 'Preview invitation'}
        busy={busy}
        disabled={joining || uncertain || (!input && !credential)}
        onPress={() => {
          if (!input && credential) void inspect(credential);
          else previewInput(input);
        }}
      />
      <InviteScanner disabled={busy || joining || uncertain} onScan={previewInput} />
      {!!message && <Notice>{message}</Notice>}
      {preview && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{preview.rideName}</Text>
          <Text style={styles.detail}>
            {transportNames[preview.transport]} ·{' '}
            {preview.state === 'lobby' ? 'In the lobby' : 'Active ride'}
          </Text>
          <Text style={styles.detail}>
            Invite expires {new Date(preview.expiresAt).toLocaleString()}.
          </Text>
          <Choices<PhysicalRole>
            label="Choose how you’re joining"
            options={preview.availableRoles.map((value) => ({ value, label: roleNames[value] }))}
            selected={role}
            onChange={setRole}
            disabled={joining || uncertain}
          />
          <Notice>
            Joining never starts location sharing. Joining as a Pillion does not pair you with
            anyone.
          </Notice>
          {uncertain && (
            <Text style={styles.detail}>
              The result is not confirmed. Retry the same join to recover your membership.
            </Text>
          )}
          <Button
            label={uncertain ? 'Retry join ride' : 'Join ride'}
            busy={joining}
            disabled={!role}
            onPress={() => {
              void join();
            }}
          />
        </View>
      )}
    </Page>
  );
}
