import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, Share, Text, View } from 'react-native';
import { Button, Notice, Page, styles } from '../src/auth/components';
import { useAuth } from '../src/auth/provider';
import { getRideManagement } from '../src/rides/api';
import type { RideManagement } from '../src/rides/models';
import { RideAccess, useRides } from '../src/rides/provider';
import {
  createStatusLink,
  listStatusLinks,
  revokeStatusLink,
  type CreatedStatusLink,
  type StatusLink,
} from '../src/status-links/api';
import { readPendingRevocations, savePendingRevocations } from '../src/status-links/storage';

export default function StatusLinksScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <RideAccess>
      <StatusLinks rideId={typeof id === 'string' ? id : ''} />
    </RideAccess>
  );
}

function StatusLinks({ rideId }: { rideId: string }) {
  const { run } = useRides();
  const auth = useAuth();
  const userId = auth.state === 'ready' ? auth.profile?.id : undefined;
  const [ride, setRide] = useState<RideManagement | null>(null);
  const [links, setLinks] = useState<StatusLink[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [lifetime, setLifetime] = useState<1 | 4 | 8 | 24>(4);
  const [newLink, setNewLink] = useState<CreatedStatusLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const creationAttempt = useRef<{ key: string; hours: 1 | 4 | 8 | 24 } | null>(null);

  const refresh = useCallback(async () => {
    if (!rideId || !userId) return;
    try {
      const saved = await readPendingRevocations(userId, rideId);
      setPending(saved);
      const result = await run(async (options) => {
        const management = await getRideManagement(options, rideId);
        let remaining = saved;
        for (const linkId of saved) {
          try {
            await revokeStatusLink(options, rideId, linkId);
            remaining = remaining.filter((id) => id !== linkId);
            await savePendingRevocations(options.userId, rideId, remaining);
          } catch {
            /* Keep an unconfirmed revoke for the next reconnect. */
          }
        }
        return { management, available: await listStatusLinks(options, rideId), remaining };
      });
      setRide(result.management);
      setNewLink((current) => {
        if (!current) return null;
        const listed = result.available.find((link) => link.linkId === current.linkId);
        return result.management.membership.sharingEnabled &&
          result.management.ride.state === 'active' &&
          listed &&
          !result.remaining.includes(current.linkId) &&
          !listed.revokedAt &&
          Date.parse(listed.expiresAt) > Date.now()
          ? current
          : null;
      });
      setLinks(result.available);
      setPending(result.remaining);
      setMessage(
        result.remaining.length
          ? 'Revocation pending. This link may still work until the server confirms it.'
          : '',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Status links are unavailable.');
    }
  }, [rideId, run, userId]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const app = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      return () => app.remove();
    }, [refresh]),
  );

  async function create() {
    if (busy || !rideId) return;
    setBusy(true);
    setMessage('');
    const attempt = creationAttempt.current ?? { key: randomUUID(), hours: lifetime };
    creationAttempt.current = attempt;
    try {
      const made = await run((options) =>
        createStatusLink(options, rideId, attempt.hours, attempt.key),
      );
      creationAttempt.current = null;
      setNewLink(made);
      await refresh();
      setMessage(
        made.url
          ? 'Link created. Share it now; Ridr cannot show this URL again after you leave this screen.'
          : 'The link was created, but its URL cannot be recovered. Revoke it and create a new one.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Link creation is unconfirmed.');
    } finally {
      setBusy(false);
    }
  }
  async function revoke(linkId: string) {
    if (busy || !rideId || !userId) return;
    setBusy(true);
    setMessage('');
    let savedLocally = false;
    try {
      const saved = await readPendingRevocations(userId, rideId);
      await savePendingRevocations(userId, rideId, [...saved, linkId]);
      savedLocally = true;
      setPending([...new Set([...saved, linkId])]);
      if (newLink?.linkId === linkId) setNewLink(null);
      await run((options) => revokeStatusLink(options, rideId, linkId));
      await savePendingRevocations(
        userId,
        rideId,
        saved.filter((id) => id !== linkId),
      );
      await refresh();
      setMessage('Link revoked.');
    } catch {
      setMessage(
        savedLocally
          ? 'Revocation pending. The link may still work until the server confirms it.'
          : 'Could not save the revocation on this device. Try again before sharing this link.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (!newLink?.url) return;
    try {
      await Share.share({ message: newLink.url });
    } catch {
      setMessage('Could not open sharing. This link remains available on this screen.');
    }
  }

  const canCreate =
    ride?.ride.state === 'active' && !ride.membership.leftAt && ride.membership.sharingEnabled;
  return (
    <Page>
      <Text style={styles.eyebrow}>YOUR STATUS · YOUR CHOICE</Text>
      <Text style={styles.title}>Share my status</Text>
      <Notice>
        Anyone with a link can see only your name, your last shared position and your SOS state.
        They do not need a Ridr account. Links stop working when you revoke them, stop sharing,
        leave or end the ride.
      </Notice>
      {message ? <Notice>{message}</Notice> : null}
      {!canCreate && (
        <Notice>Start location sharing on an active ride to create a status link.</Notice>
      )}
      {canCreate && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Choose a lifetime</Text>
          {([1, 4, 8, 24] as const).map((hours) => (
            <Button
              key={hours}
              label={`${hours} ${hours === 1 ? 'hour' : 'hours'}${lifetime === hours ? ' · selected' : ''}`}
              onPress={() => setLifetime(hours)}
              secondary={lifetime !== hours}
              disabled={busy}
            />
          ))}
          <Button label="Create private link" onPress={() => void create()} busy={busy} />
        </View>
      )}
      {newLink?.url && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>New link ready</Text>
          <Text style={styles.detail}>
            Expires {new Date(newLink.expiresAt).toLocaleString()}. Anyone who receives the URL can
            view your limited status until you revoke it or sharing ends.
          </Text>
          <Button label="Share link" onPress={() => void share()} />
        </View>
      )}
      <Text style={styles.cardTitle}>My links</Text>
      {links.length === 0 && <Notice>No links created for this ride.</Notice>}
      {links.map((link) => {
        const waiting = pending.includes(link.linkId);
        const active = !link.revokedAt && Date.parse(link.expiresAt) > Date.now();
        return (
          <View key={link.linkId} style={styles.card}>
            <Text style={styles.label}>Created {new Date(link.createdAt).toLocaleString()}</Text>
            <Text style={styles.detail}>Expires {new Date(link.expiresAt).toLocaleString()}</Text>
            <Text style={styles.detail}>
              {waiting
                ? 'Revocation pending — link may still work'
                : link.revokedAt
                  ? 'Revoked'
                  : active
                    ? 'Active bearer link'
                    : 'Expired'}
            </Text>
            {active && (
              <Button
                label={waiting ? 'Retry revocation' : 'Revoke link'}
                onPress={() => void revoke(link.linkId)}
                secondary
                busy={busy}
              />
            )}
          </View>
        );
      })}
    </Page>
  );
}
