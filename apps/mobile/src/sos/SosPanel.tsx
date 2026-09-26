import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useAuth } from '../auth/provider';
import { Button, Field, Notice, Page, styles } from '../auth/components';
import { registerDevice } from '../location/api';
import { RideError } from '../rides/api';
import { getRideManagement } from '../rides/api';
import { useRides } from '../rides/provider';
import {
  acknowledgeSos,
  listSos,
  newSosEvent,
  readSos,
  reconfirmSos,
  resolveSos,
  sendSos,
  type SosEvent,
  type SosView,
} from './api';
import { takeSosPosition } from './capture';
import { clearPendingSos, readPendingSos, savePendingSos, sosDeviceId } from './storage';

export function SosPanel({ rideId, autoStart }: { rideId: string; autoStart: boolean }) {
  const auth = useAuth();
  const owner = auth.profile?.id ?? '';
  const { run } = useRides();
  const [events, setEvents] = useState<SosView[]>([]);
  const [pending, setPending] = useState<SosEvent | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading SOS status…');
  const [busy, setBusy] = useState(false);
  const [leader, setLeader] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const started = useRef(false);
  const reading = useRef(false);
  const mounted = useRef(true);
  const selected = events.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!owner || reading.current) return;
    reading.current = true;
    try {
      const [management, received] = await Promise.all([
        run((options) => getRideManagement(options, rideId)),
        run((options) => listSos(options, rideId)),
      ]);
      if (!mounted.current) return;
      setLeader(management.membership.role === 'leader');
      setMemberId(management.membership.id);
      setEvents(received);
      if (pending) {
        try {
          const accepted = await run((options) => readSos(options, pending));
          await clearPendingSos(owner, rideId);
          if (mounted.current) {
            setPending(null);
            setSelectedId(accepted.id);
            setEvents((previous) => [
              accepted,
              ...previous.filter((item) => item.id !== accepted.id),
            ]);
            setStatus('Accepted by server. Device acknowledgements appear below as they arrive.');
          }
        } catch (error) {
          if (!(error instanceof RideError && error.code === 'not_found')) throw error;
        }
      }
      const deviceId = await sosDeviceId(owner);
      for (const event of received) {
        if (
          event.deviceId === deviceId ||
          event.deviceReceipts.some((receipt) => receipt.deviceId === deviceId)
        )
          continue;
        try {
          await run(async (options) => {
            await registerDevice(options, deviceId, Platform.OS === 'ios' ? 'ios' : 'android');
            return acknowledgeSos(options, rideId, event.id, deviceId);
          });
        } catch {
          // A missing receipt is visible to the reporter and retried on the next refresh.
        }
      }
    } catch (error) {
      if (mounted.current)
        setStatus(error instanceof Error ? error.message : 'SOS status could not be refreshed.');
    } finally {
      reading.current = false;
    }
  }, [owner, pending, rideId, run]);

  const transmit = useCallback(
    async (event: SosEvent, grantId?: string) => {
      if (!owner) return;
      setBusy(true);
      setStatus('Sending… Saved on this device. Server acceptance is not yet confirmed.');
      let submitted = false;
      try {
        const deviceId = await sosDeviceId(owner);
        await run((options) =>
          registerDevice(options, deviceId, Platform.OS === 'ios' ? 'ios' : 'android'),
        );
        submitted = true;
        const accepted = await run((options) => sendSos(options, event, deviceId, grantId));
        await clearPendingSos(owner, rideId);
        if (mounted.current) {
          setPending(null);
          setSelectedId(accepted.id);
          setEvents((previous) => [
            accepted,
            ...previous.filter((item) => item.id !== accepted.id),
          ]);
          setStatus('Accepted by server. Device acknowledgements appear below as they arrive.');
        }
      } catch (error) {
        if (mounted.current)
          setStatus(
            !submitted
              ? 'Not sent — this device could not register with the ride service. Reconnect and try again.'
              : error instanceof RideError && error.unconfirmed
                ? 'Delivery unconfirmed. The server may have accepted this SOS. Check status before retrying.'
                : error instanceof Error
                  ? `Not accepted: ${error.message}`
                  : 'SOS acceptance could not be confirmed.',
          );
      } finally {
        setBusy(false);
      }
    },
    [owner, rideId, run],
  );

  const startFresh = useCallback(async () => {
    const capturedAt = new Date().toISOString();
    const position = takeSosPosition(rideId);
    const permittedPosition =
      position &&
      Date.parse(position.recordedAt) <= Date.parse(capturedAt) &&
      Date.parse(capturedAt) - Date.parse(position.recordedAt) <= 600000
        ? position
        : null;
    const event = newSosEvent(rideId, randomUUID(), capturedAt, permittedPosition);
    await savePendingSos(owner, event);
    if (mounted.current) {
      setPending(event);
      setSelectedId(event.id);
      void transmit(event);
    }
  }, [owner, rideId, transmit]);

  useEffect(() => {
    if (!owner || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const saved = await readPendingSos(owner, rideId);
        if (!mounted.current) return;
        if (saved) {
          setPending(saved);
          setSelectedId(saved.id);
          setStatus('Saved SOS found. Checking whether the server accepted it…');
          let reconciled = false;
          try {
            const accepted = await run((options) => readSos(options, saved));
            await clearPendingSos(owner, rideId);
            reconciled = true;
            if (mounted.current) {
              setPending(null);
              setEvents((previous) => [
                accepted,
                ...previous.filter((item) => item.id !== accepted.id),
              ]);
              setStatus('Accepted by server.');
            }
          } catch (error) {
            if (mounted.current)
              setStatus(
                error instanceof RideError && error.code === 'not_found'
                  ? 'This SOS has not been accepted. Retry or reconfirm below.'
                  : 'Delivery unconfirmed. Reconnect to check before retrying.',
              );
          }
          if (reconciled && autoStart && mounted.current) await startFresh();
        } else if (autoStart) {
          await startFresh();
        }
        void refresh();
      } catch (error) {
        if (mounted.current)
          setStatus(
            error instanceof Error ? error.message : 'Could not safely save SOS. Nothing was sent.',
          );
      }
    })();
  }, [owner, rideId, autoStart, run, refresh, startFresh]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const timer = setInterval(() => {
        void refresh();
      }, 3000);
      return () => {
        clearInterval(timer);
      };
    }, [refresh]),
  );

  async function checkAndRetry() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const accepted = await run((options) => readSos(options, pending));
      await clearPendingSos(owner, rideId);
      setPending(null);
      setSelectedId(accepted.id);
      setEvents((previous) => [accepted, ...previous.filter((item) => item.id !== accepted.id)]);
      setStatus('Accepted by server.');
    } catch (error) {
      if (!(error instanceof RideError && error.code === 'not_found')) {
        setStatus('Delivery unconfirmed. Reconnect to check before retrying.');
        setBusy(false);
        return;
      }
      setBusy(false);
      if (Date.now() - Date.parse(pending.capturedAt) > 86400000) {
        try {
          await clearPendingSos(owner, rideId);
          setPending(null);
          await startFresh();
        } catch {
          setStatus('Could not safely save a fresh SOS on this device. Nothing new was sent.');
        }
        return;
      }
      if (Date.now() - Date.parse(pending.capturedAt) > 60000) {
        setStatus('This SOS is over one minute old. Confirm again if help is still needed.');
        return;
      }
      await transmit(pending);
      return;
    }
    setBusy(false);
  }
  async function reconfirm() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const result = await run((options) =>
        reconfirmSos(options, pending, randomUUID(), new Date().toISOString()),
      );
      if (result.accepted) {
        await clearPendingSos(owner, rideId);
        setPending(null);
        setEvents((previous) => [
          result.accepted!,
          ...previous.filter((item) => item.id !== result.accepted!.id),
        ]);
        setStatus('Accepted by server.');
      } else if (result.grant) {
        setBusy(false);
        await transmit(pending, result.grant.grantId);
        return;
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not reconfirm SOS.');
    }
    setBusy(false);
  }
  async function resolve(sosId: string, kind: 'reporter_okay' | 'coordination_closed') {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await run((options) =>
        resolveSos(options, rideId, sosId, randomUUID(), kind, reason.trim()),
      );
      setEvents((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
      setStatus('Resolution update accepted. It remains visible to the ride.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Resolution update failed.');
    }
    setBusy(false);
  }
  return (
    <Page>
      <Text style={styles.eyebrow}>RIDE SAFETY</Text>
      <Text style={styles.title}>SOS</Text>
      <Notice>{status}</Notice>
      <Text style={styles.detail}>
        For immediate danger, contact local emergency services directly. Ridr alerts ride members;
        it does not dispatch help.
      </Text>
      {pending && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>SOS on this device</Text>
          <Text style={styles.detail}>
            Captured {new Date(pending.capturedAt).toLocaleString()} · Server acceptance unconfirmed
          </Text>
          <Button
            label={
              Date.now() - Date.parse(pending.capturedAt) > 86400000
                ? 'Check acceptance, then start a fresh SOS'
                : 'Check acceptance, then retry if needed'
            }
            busy={busy}
            onPress={() => {
              void checkAndRetry();
            }}
          />
          {Date.now() - Date.parse(pending.capturedAt) > 60000 &&
            Date.now() - Date.parse(pending.capturedAt) <= 86400000 && (
              <Button
                label="I still need help — reconfirm SOS"
                busy={busy}
                onPress={() => {
                  void reconfirm();
                }}
              />
            )}
        </View>
      )}
      {events.map((event) => (
        <View key={event.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {event.resolution ? 'Resolved update' : 'SOS active'} · {event.reporterName}
          </Text>
          {event.pairSnapshot && (
            <Text style={styles.detail}>
              Paired at capture: {event.pairSnapshot.riderName} and {event.pairSnapshot.pillionName}
            </Text>
          )}
          <Text style={styles.detail}>
            Reported by {event.reporterName} · accepted{' '}
            {new Date(event.acceptedAt).toLocaleString()}
          </Text>
          <Text style={styles.detail}>
            {event.position
              ? `Last permitted position: ${event.position.lat.toFixed(5)}, ${event.position.lon.toFixed(5)} · ±${Math.round(event.position.accuracyM)} m · sampled ${new Date(event.position.recordedAt).toLocaleString()}`
              : 'No permitted location attached.'}
          </Text>
          <Text style={styles.detail}>
            {event.deviceReceipts.length
              ? `Device acknowledgements: ${event.deviceReceipts.map((item) => item.memberName).join(', ')}. This confirms delivery to those devices, not that people saw it.`
              : 'No recipient device has acknowledged this alert yet.'}
          </Text>
          {!!event.linkedSosIds.length && (
            <Text style={styles.detail}>
              Linked report from the paired member: {event.linkedSosIds.length}
            </Text>
          )}
          {event.resolution && (
            <Text style={styles.detail}>
              {event.resolution.kind === 'reporter_okay'
                ? 'Reporter says they are okay'
                : `Leader closed coordination: ${event.resolution.reason ?? ''}`}
            </Text>
          )}
          {!event.resolution && event.reporterMemberId === memberId && (
            <Button
              label="I'm okay"
              secondary
              busy={busy}
              onPress={() => {
                void resolve(event.id, 'reporter_okay');
              }}
            />
          )}
          {!event.resolution && leader && (
            <Button label="Close coordination" secondary onPress={() => setSelectedId(event.id)} />
          )}
        </View>
      ))}
      {selected && !selected.resolution && leader && (
        <View style={styles.card}>
          <Text style={styles.label}>Close coordination for {selected.reporterName}</Text>
          <Field label="Reason" value={reason} onChangeText={setReason} maxLength={300} />
          <Button
            label="Post closure update"
            disabled={!reason.trim()}
            busy={busy}
            onPress={() => {
              void resolve(selected.id, 'coordination_closed');
            }}
          />
        </View>
      )}
    </Page>
  );
}
