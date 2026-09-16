import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Notice, styles } from '../auth/components';
import { stopAndClearDiagnostics } from '../device/diagnostics';
import {
  acceptLeadership,
  acceptRole,
  cancelRideProposal,
  endRide,
  leaveRide,
  proposeLeadership,
  proposeRole,
  RideError,
  startRide,
  stopRideSharing,
  type RideClientOptions,
} from './api';
import type { Membership, RideManagement, RideProposal } from './models';
import { useRides } from './provider';
import { safetyOutcomeConfirmed, type SafetyAction } from './safety-action';
import { useMotionCheck } from './use-motion-check';
import { useScreenTask } from './use-screen-task';

type Command = {
  label: string;
  request(options: RideClientOptions): Promise<unknown>;
  safety?: SafetyAction;
};

export function RideControls({
  management,
  members,
  onChanged,
}: {
  management: RideManagement;
  members: Membership[];
  onChanged(): void;
}) {
  const { ride, membership, proposals } = management;
  const { run, safetyActions, rememberSafetyAction, rememberInvitation } = useRides();
  const motion = useMotionCheck();
  const capture = useScreenTask();
  const pending = useRef<Command | null>(null);
  const queuedSafety = useRef<SafetyAction | null>(null);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [cleanupWarning, setCleanupWarning] = useState('');
  const [confirmation, setConfirmation] = useState<'end' | 'leave' | null>(null);
  const live = ride.state !== 'ended' && membership.leftAt === null;
  const leader = membership.role === 'leader';
  const safety = safetyActions[ride.id];

  useEffect(() => {
    if (safety && safetyOutcomeConfirmed(safety, management)) {
      rememberSafetyAction(ride.id, null);
      if (queuedSafety.current?.idempotencyKey === safety.idempotencyKey)
        queuedSafety.current = null;
      if (pending.current?.safety?.idempotencyKey === safety.idempotencyKey) {
        pending.current = null;
        setUncertain(false);
      }
    }
    if (!live && !safety) {
      pending.current = null;
      setUncertain(false);
    }
  }, [management, safety, live, ride.id, rememberSafetyAction]);

  function stopLocalActivity() {
    const current = capture();
    motion.reset();
    void stopAndClearDiagnostics().catch(() => {
      if (current())
        setCleanupWarning(
          'Local location cleanup needs attention. Turn off Ridr location access in Settings.',
        );
    });
  }

  async function execute(command: Command) {
    if (working.current) return;
    working.current = true;
    const current = capture();
    pending.current = command;
    setBusy(true);
    setUncertain(true);
    setMessage('');
    setConfirmation(null);
    if (command.safety) {
      rememberSafetyAction(ride.id, command.safety);
    }
    try {
      await run(command.request);
      if (pending.current !== command) return;
      pending.current = null;
      setUncertain(false);
      if (command.safety) rememberSafetyAction(ride.id, null);
      if (command.safety?.kind === 'end' || command.safety?.kind === 'leave')
        rememberInvitation(ride.id, null);
      if (current()) {
        setMessage(
          command.safety?.kind === 'stop'
            ? 'The server checked your stop request. Your current sharing state is shown below.'
            : `${command.label} confirmed.`,
        );
        onChanged();
      }
    } catch (error) {
      if (pending.current !== command) return;
      const unconfirmed = error instanceof RideError && error.unconfirmed;
      setUncertain(unconfirmed);
      if (!unconfirmed) {
        pending.current = null;
        if (command.safety) rememberSafetyAction(ride.id, null);
      }
      if (current()) {
        setMessage(error instanceof Error ? error.message : 'This change could not be confirmed.');
        if (!unconfirmed) onChanged();
      }
    } finally {
      working.current = false;
      setBusy(false);
      const queued = queuedSafety.current;
      queuedSafety.current = null;
      if (queued) void execute(safetyCommand(queued));
    }
  }

  function safetyCommand(action: SafetyAction): Command {
    const common = {
      rideId: action.rideId,
      idempotencyKey: action.idempotencyKey,
      consentEpoch: action.consentEpoch,
    };
    return {
      label:
        action.kind === 'end'
          ? 'Ride end'
          : action.kind === 'leave'
            ? 'Leaving the ride'
            : 'Stop sharing',
      safety: action,
      request: (options) =>
        action.kind === 'end'
          ? endRide(options, { ...common, reason: action.reason, capturedAt: action.capturedAt })
          : action.kind === 'leave'
            ? leaveRide(options, { ...common, stoppedAt: action.capturedAt })
            : stopRideSharing(options, { ...common, stoppedAt: action.capturedAt }),
    };
  }

  function stop(kind: SafetyAction['kind']) {
    const action = safety ?? {
      kind,
      rideId: ride.id,
      idempotencyKey: randomUUID(),
      consentEpoch: membership.consentEpoch,
      capturedAt: new Date().toISOString(),
      reason: ride.state === 'lobby' ? 'cancelled' : 'completed',
    };
    stopLocalActivity();
    rememberSafetyAction(ride.id, action);
    if (working.current) queuedSafety.current = action;
    else void execute(safetyCommand(action));
  }

  function stationary(make: (context: ReturnType<typeof motion.latest>, key: string) => Command) {
    try {
      void execute(make(motion.latest(), randomUUID()));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Check that you are stopped first.');
    }
  }
  function accept(proposal: RideProposal) {
    stationary((context, idempotencyKey) => ({
      label: proposal.kind === 'leadership' ? 'Leadership transfer' : 'Role change',
      request: (options) =>
        proposal.kind === 'leadership'
          ? acceptLeadership(options, { ride, proposal, idempotencyKey, ...context })
          : acceptRole(options, { ride, proposal, idempotencyKey, ...context }),
    }));
  }
  function propose(member: Membership, leadership: boolean) {
    stationary((context, idempotencyKey) => ({
      label: 'Request',
      request: (options) =>
        leadership
          ? proposeLeadership(options, {
              rideId: ride.id,
              targetMemberId: member.id,
              revision: ride.revision,
              idempotencyKey,
              ...context,
            })
          : proposeRole(options, {
              rideId: ride.id,
              targetMemberId: member.id,
              physicalRole: member.physicalRole === 'rider' ? 'pillion' : 'rider',
              revision: ride.revision,
              idempotencyKey,
              ...context,
            }),
    }));
  }

  return (
    <View style={{ gap: 18 }}>
      {!!cleanupWarning && <Notice>{cleanupWarning}</Notice>}
      {!!message && <Notice>{message}</Notice>}
      {(safety || uncertain) && (
        <View style={styles.card}>
          <Notice>
            {safety?.kind === 'end'
              ? 'End pending — other members may still be active.'
              : safety?.kind === 'leave'
                ? 'Leave pending — your departure is not yet confirmed.'
                : safety?.kind === 'stop'
                  ? 'Stop pending — the server has not confirmed your sharing state.'
                  : 'This change is unconfirmed. Retry the same request before making another change.'}
          </Notice>
          <Button
            label="Retry pending request"
            busy={busy}
            onPress={() => {
              if (safety) {
                stopLocalActivity();
                void execute(safetyCommand(safety));
              } else if (pending.current) void execute(pending.current);
            }}
          />
        </View>
      )}
      {live && (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ride controls</Text>
            <Text style={styles.detail}>
              Starting the ride keeps location sharing off. A brief speed check is needed for start
              and role controls. No coordinates from that check are saved or sent.
            </Text>
            <Button
              label="Check that I’m stopped"
              secondary
              busy={motion.checking}
              disabled={busy || !!safety || uncertain}
              onPress={() => {
                void motion.check();
              }}
            />
            {!!motion.message && <Notice>{motion.message}</Notice>}
            {leader && ride.state === 'lobby' && (
              <Button
                label="Start ride"
                busy={busy}
                disabled={!motion.ready || !!safety || uncertain}
                onPress={() =>
                  stationary((context, idempotencyKey) => ({
                    label: 'Ride start',
                    request: (options) =>
                      startRide(options, {
                        rideId: ride.id,
                        revision: ride.revision,
                        idempotencyKey,
                        ...context,
                      }),
                  }))
                }
              />
            )}
            <Button
              label="Stop sharing"
              secondary
              disabled={!!safety}
              onPress={() => stop('stop')}
            />
            <Button
              label={
                leader
                  ? ride.state === 'lobby'
                    ? 'Cancel ride for everyone'
                    : 'End ride for everyone'
                  : 'Leave ride'
              }
              secondary
              disabled={!!safety}
              onPress={() => setConfirmation(leader ? 'end' : 'leave')}
            />
            {confirmation && (
              <View style={{ gap: 10 }}>
                <Notice>
                  {confirmation === 'end'
                    ? 'This ends the ride for everyone. It cannot be restarted.'
                    : 'Leaving removes your access to this ride and ends any pairing.'}
                </Notice>
                <Button
                  label={confirmation === 'end' ? 'Confirm end ride' : 'Confirm leave ride'}
                  onPress={() => stop(confirmation)}
                />
                <Button label="Keep riding" secondary onPress={() => setConfirmation(null)} />
              </View>
            )}
          </View>
          {proposals.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Requests awaiting a response</Text>
              {proposals.map((proposal) => (
                <View key={proposal.id} style={{ gap: 10 }}>
                  <Text style={styles.label}>
                    {proposal.kind === 'leadership'
                      ? 'Become the ride leader'
                      : `Change role to ${proposal.physicalRole === 'rider' ? 'Rider' : 'Pillion'}`}
                  </Text>
                  <Text style={styles.detail}>
                    {proposal.targetMemberId === membership.id
                      ? 'For you'
                      : `For ${members.find((member) => member.id === proposal.targetMemberId)?.displayName ?? 'a ride member'}`}{' '}
                    · expires {new Date(proposal.expiresAt).toLocaleTimeString()}
                  </Text>
                  {proposal.targetMemberId === membership.id && (
                    <Button
                      label="Accept request"
                      busy={busy}
                      disabled={!motion.ready || !!safety || uncertain}
                      onPress={() => accept(proposal)}
                    />
                  )}
                  <Button
                    label={
                      proposal.targetMemberId === membership.id
                        ? 'Decline request'
                        : 'Cancel request'
                    }
                    secondary
                    busy={busy}
                    disabled={!!safety || uncertain}
                    onPress={() => {
                      const idempotencyKey = randomUUID();
                      void execute({
                        label: 'Request cancellation',
                        request: (options) =>
                          cancelRideProposal(options, {
                            rideId: ride.id,
                            kind: proposal.kind,
                            proposalId: proposal.id,
                            idempotencyKey,
                          }),
                      });
                    }}
                  />
                </View>
              ))}
            </View>
          )}
          {leader && members.length > 1 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Manage your group</Text>
              <Text style={styles.detail}>
                Every change needs the other member’s acceptance. Only a Rider can become leader.
              </Text>
              {members
                .filter((member) => member.id !== membership.id)
                .map((member) => (
                  <View key={member.id} style={{ gap: 10 }}>
                    <Text style={styles.label}>{member.displayName}</Text>
                    {ride.transport === 'motorcycle' && (
                      <Button
                        label={`Ask to become ${member.physicalRole === 'rider' ? 'Pillion' : 'Rider'}`}
                        secondary
                        busy={busy}
                        disabled={!motion.ready || !!safety || uncertain}
                        onPress={() => propose(member, false)}
                      />
                    )}
                    {member.physicalRole === 'rider' && (
                      <Button
                        label="Offer leadership"
                        secondary
                        busy={busy}
                        disabled={!motion.ready || !!safety || uncertain}
                        onPress={() => propose(member, true)}
                      />
                    )}
                  </View>
                ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}
