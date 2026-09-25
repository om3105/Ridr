import { TrailView } from '../src/group-map/TrailView';
import { RideChat } from '../src/chat/RideChat';
import { GroupRideMap } from '../src/group-map/GroupRideMap';
import { stopTracking } from '../src/location/tracker';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Button, Notice, Page, styles } from '../src/auth/components';
import {
  getRide,
  getRideManagement,
  previewInvitation,
  revokeInvitation,
  rotateInvitation,
  RideError,
} from '../src/rides/api';
import { roleNames, transportNames } from '../src/rides/components';
import { parseInvitationLink } from '../src/rides/invitations';
import type { MotionContext, RideManagement, RideSnapshot } from '../src/rides/models';
import { RideControls } from '../src/rides/RideControls';
import { checkStationary, stopMotionCheck } from '../src/rides/motion-check';
import { stopAndClearDiagnostics } from '../src/device/diagnostics';
import { RideAccess, useRides } from '../src/rides/provider';
import { useScreenTask } from '../src/rides/use-screen-task';

export default function RideScreen() {
  const { id, view, member, lat, lon, focusLat, focusLon } = useLocalSearchParams<{
    id?: string | string[];
    view?: string;
    member?: string;
    lat?: string;
    lon?: string;
    focusLat?: string;
    focusLon?: string;
  }>();
  return (
    <RideAccess>
      <Lobby
        showControls={view === 'controls'}
        trailMember={view === 'trail' ? member : undefined}
        chatPin={
          view === 'chat' &&
          lat !== undefined &&
          lon !== undefined &&
          Number.isFinite(Number(lat)) &&
          Number.isFinite(Number(lon)) &&
          Math.abs(Number(lat)) <= 90 &&
          Math.abs(Number(lon)) <= 180
            ? { lat: Number(lat), lon: Number(lon) }
            : null
        }
        showChat={view === 'chat'}
        mapFocus={
          focusLat !== undefined &&
          focusLon !== undefined &&
          Number.isFinite(Number(focusLat)) &&
          Number.isFinite(Number(focusLon)) &&
          Math.abs(Number(focusLat)) <= 90 &&
          Math.abs(Number(focusLon)) <= 180
            ? { lat: Number(focusLat), lon: Number(focusLon) }
            : null
        }
        key={typeof id === 'string' ? id : 'invalid'}
        id={typeof id === 'string' ? id : ''}
      />
    </RideAccess>
  );
}

function Lobby({
  id,
  showControls,
  trailMember,
  chatPin,
  showChat,
  mapFocus,
}: {
  id: string;
  showControls: boolean;
  trailMember?: string;
  chatPin: { lat: number; lon: number } | null;
  showChat: boolean;
  mapFocus: { lat: number; lon: number } | null;
}) {
  const { run, invitations, rememberInvitation } = useRides();
  const capture = useScreenTask();
  const [snapshot, setSnapshot] = useState<RideSnapshot | null>(null);
  const [management, setManagement] = useState<RideManagement | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const sequence = useRef(0);
  const fetching = useRef(false);
  const stoppedFor = useRef<string | null>(null);
  const operation = useRef<{
    kind: 'rotate' | 'revoke';
    idempotencyKey: string;
    revision: number;
    motionContext?: MotionContext;
  } | null>(null);
  const invite = invitations[id];
  const load = useCallback(async () => {
    if (fetching.current || AppState.currentState !== 'active') return;
    fetching.current = true;
    const current = capture();
    const request = ++sequence.current;
    setLoading(true);
    try {
      const status = await run((options) => getRideManagement(options, id));
      if (!current() || request !== sequence.current) return;
      setManagement(status);
      if (status.ride.state === 'ended' || status.membership.leftAt !== null) {
        setSnapshot(null);
        rememberInvitation(id, null);
        if (stoppedFor.current !== id) {
          stoppedFor.current = id;
          stopMotionCheck();
          void Promise.all([stopTracking(), stopAndClearDiagnostics()]).catch(() => {
            if (current())
              setMessage(
                'This ride has ended or you have left. Turn off Ridr location access in Settings if local cleanup failed.',
              );
          });
        }
        return;
      }
      const result = await run((options) => getRide(options, id));
      if (current() && request === sequence.current) setSnapshot(result);
    } catch (error) {
      if (current() && request === sequence.current) {
        setSnapshot(null);
        rememberInvitation(id, null);
        setMessage(error instanceof Error ? error.message : 'Your ride could not be loaded.');
      }
    } finally {
      fetching.current = false;
      if (request === sequence.current) setLoading(false);
    }
  }, [run, capture, id, rememberInvitation]);
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        void load();
      }, 5000);
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load();
        else stopMotionCheck();
      });
      return () => {
        clearInterval(timer);
        listener.remove();
        stopMotionCheck();
      };
    }, [load]),
  );

  async function changeInvitation(kind: 'rotate' | 'revoke') {
    if (busy || !snapshot) return;
    const current = capture();
    setBusy(true);
    setMessage('');
    try {
      if (!operation.current) {
        const motionContext =
          kind === 'rotate' && snapshot.ride.state === 'active'
            ? await checkStationary()
            : undefined;
        if (!current()) return;
        operation.current = {
          kind,
          idempotencyKey: randomUUID(),
          revision: snapshot.ride.revision,
          motionContext,
        };
      }
      const pending = operation.current;
      setUncertain(true);
      // The preceding invitation may be invalidated even if the response is lost.
      rememberInvitation(id, null);
      if (pending.kind === 'rotate') {
        const result = await run((options) =>
          rotateInvitation(options, {
            rideId: id,
            revision: pending.revision,
            idempotencyKey: pending.idempotencyKey,
            motionContext: pending.motionContext,
          }),
        );
        if (!current()) return;
        rememberInvitation(id, result);
        setMessage(
          result.tokenAvailable
            ? 'A new invitation is ready. The previous invitation no longer works.'
            : 'The invitation was replaced, but its code cannot be recovered. Replace it again to receive a new code.',
        );
      } else {
        await run((options) =>
          revokeInvitation(options, { rideId: id, idempotencyKey: pending.idempotencyKey }),
        );
        if (!current()) return;
        setMessage('The invitation was revoked. Existing members remain in the ride.');
      }
      operation.current = null;
      setUncertain(false);
      await load();
    } catch (error) {
      if (!current()) return;
      const unconfirmed = error instanceof RideError && error.unconfirmed;
      setUncertain(unconfirmed);
      if (!unconfirmed) operation.current = null;
      setMessage(
        error instanceof Error ? error.message : 'The invitation change could not be confirmed.',
      );
      if (!unconfirmed) await load();
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (busy || !invite?.url || !invite.code) return;
    const credential = parseInvitationLink(invite.url);
    if (!credential) return;
    const current = capture();
    setBusy(true);
    setMessage('');
    try {
      const preview = await run((options) => previewInvitation(options, credential));
      if (!current()) return;
      if (preview.rideId !== id)
        throw new Error('This invitation no longer belongs to the open ride.');
      await Share.share({
        message: `Join ${preview.rideName} on Ridr. Code: ${invite.code}\n${displayUrl}`,
      });
    } catch (error) {
      if (current())
        setMessage(error instanceof Error ? error.message : 'The invitation could not be shared.');
    } finally {
      setBusy(false);
    }
  }
  const displayUrl =
    Constants.expoConfig?.scheme === 'ridr-dev'
      ? invite?.url?.replace(/^ridr:/, 'ridr-dev:')
      : invite?.url;
  const leader = snapshot?.membership.role === 'leader';
  if (showChat) return <RideChat id={id} pin={chatPin} />;
  if (management && trailMember)
    return (
      <TrailView
        key={trailMember}
        id={id}
        memberId={trailMember}
        ownMemberId={management.membership.id}
        active={management.ride.state === 'active' && !management.membership.leftAt}
        name={
          snapshot?.members.find((member) => member.id === trailMember)?.displayName ?? 'Member'
        }
      />
    );
  if (management?.ride.state === 'active' && !management.membership.leftAt && !showControls)
    return (
      <GroupRideMap
        id={id}
        name={management.ride.name}
        startedAt={management.ride.startedAt}
        focus={mapFocus}
        physicalRole={management.membership.physicalRole}
      />
    );
  return (
    <Page>
      <Text accessibilityRole="header" style={styles.title}>
        {management?.ride.name ?? snapshot?.ride.name ?? 'Your ride.'}
      </Text>
      {!!message && <Notice>{message}</Notice>}
      {management?.ride.startedAt && (
        <Link
          href={{
            pathname: '/ride',
            params: { id, view: 'trail', member: management.membership.id },
          }}
          style={styles.link}
        >
          View your recorded trail →
        </Link>
      )}
      {management && (
        <>
          {management.ride.state === 'ended' && (
            <Notice>This ride has ended. Location sharing is off.</Notice>
          )}
          {management.membership.leftAt !== null && management.ride.state !== 'ended' && (
            <Notice>You have left this ride. Your live access and sharing have ended.</Notice>
          )}
          <RideControls
            management={management}
            members={snapshot?.members ?? []}
            onChanged={() => {
              void load();
            }}
          />
        </>
      )}
      {snapshot?.ride.state === 'active' && (
        <Link href={{ pathname: '/ride', params: { id } }} style={styles.link}>
          Open group map →
        </Link>
      )}
      {snapshot?.ride.state === 'active' && (
        <Link href={{ pathname: '/sharing', params: { id } }} style={styles.link}>
          Location sharing & live status →
        </Link>
      )}
      {snapshot && (
        <Link href={{ pathname: '/route', params: { id } }} style={styles.link}>
          View or plan the route →
        </Link>
      )}
      {snapshot && (
        <>
          <Text style={styles.detail}>
            {transportNames[snapshot.ride.transport]} ·{' '}
            {snapshot.ride.state === 'lobby' ? 'Lobby' : 'Active ride'} · {snapshot.members.length}
            /50 people
          </Text>
          <Notice>
            {snapshot.membership.sharingEnabled
              ? 'Your location sharing is enabled.'
              : 'Your location sharing is off. Opening or joining this ride does not start tracking.'}
          </Notice>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your people</Text>
            {snapshot.members.map((member) => (
              <View key={member.id} style={{ gap: 3 }}>
                <Text style={styles.label}>
                  {member.displayName}
                  {member.id === snapshot.membership.id ? ' (you)' : ''}
                </Text>
                <Text style={styles.detail}>
                  {member.role === 'leader' ? 'Leader · Rider' : roleNames[member.physicalRole]}
                </Text>
              </View>
            ))}
          </View>
          {leader && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Invite your people</Text>
              {invite?.tokenAvailable && displayUrl ? (
                <>
                  <Text selectable style={[styles.cardTitle, { letterSpacing: 2 }]}>
                    {invite.code}
                  </Text>
                  <View
                    accessible
                    accessibilityLabel="Ride invitation QR code"
                    style={{ alignSelf: 'center', padding: 12, backgroundColor: 'white' }}
                  >
                    <QRCode value={displayUrl} size={200} />
                  </View>
                  <Text style={styles.detail}>
                    Expires {new Date(invite.expiresAt).toLocaleString()}, or sooner if replaced or
                    revoked.
                  </Text>
                  <Button
                    label="Share invitation"
                    busy={busy}
                    disabled={loading || uncertain}
                    onPress={() => {
                      void share();
                    }}
                  />
                </>
              ) : (
                <Text style={styles.detail}>
                  This invitation’s code is no longer available on this device. Replace the
                  invitation to get a new code and QR; existing members stay in the ride.
                </Text>
              )}
              {uncertain && (
                <Notice>The change is unconfirmed. Retry it to recover the result safely.</Notice>
              )}
              {snapshot.ride.state !== 'ended' && (
                <Button
                  label={
                    uncertain && operation.current?.kind === 'rotate'
                      ? 'Retry invitation replacement'
                      : snapshot.ride.state === 'active'
                        ? 'Check speed and replace invitation'
                        : 'Replace invitation'
                  }
                  secondary
                  busy={busy}
                  disabled={loading || (uncertain && operation.current?.kind !== 'rotate')}
                  onPress={() => {
                    void changeInvitation('rotate');
                  }}
                />
              )}
              <Button
                label={
                  uncertain && operation.current?.kind === 'revoke'
                    ? 'Retry invitation revocation'
                    : 'Revoke invitation'
                }
                secondary
                busy={busy}
                disabled={loading || (uncertain && operation.current?.kind !== 'revoke')}
                onPress={() => {
                  void changeInvitation('revoke');
                }}
              />
            </View>
          )}
        </>
      )}
      <Button
        label={loading ? 'Loading ride…' : 'Refresh ride'}
        secondary
        busy={loading}
        disabled={busy}
        onPress={() => {
          setMessage('');
          void load();
        }}
      />
      <Link href="/rides" style={styles.link}>
        Back to your rides →
      </Link>
    </Page>
  );
}
