import { randomUUID } from 'node:crypto';
import { pairStatuses } from './ride-readiness.js';
import type { PoolClient } from 'pg';
import { ApiError } from './api-errors.js';
import {
  integer,
  memberProjection,
  rideProjection,
  type MemberRow,
  type RideRow,
} from './ride-records.js';
import type {
  AcceptChange,
  EndRide,
  LeftRide,
  Membership,
  MotionContext,
  PhysicalRole,
  ProposalKind,
  ProposedChange,
  ProposeChange,
  Ride,
  RideManagement,
  SharingState,
  StartRide,
  StopSharing,
} from './ride-types.js';

export interface ManagementContext {
  client: PoolClient;
  ride: RideRow;
  members: MemberRow[];
  own: MemberRow;
}
interface ProposalRow {
  id: string;
  kind: ProposalKind;
  requester_member_id: string;
  target_member_id: string;
  payload: {
    rideRevision: number;
    state: string;
    requesterRevision: number;
    targetRevision: number;
    physicalRole: PhysicalRole | null;
  };
  expires_at: Date;
  accepted_at: Date | null;
  canceled_at: Date | null;
}
const conflict = (code: string, message: string) => new ApiError(409, code, message);
const notFound = () => new ApiError(404, 'NOT_FOUND', 'Resource not found.');
const current = (context: ManagementContext) => {
  if (context.ride.state === 'ended' || context.own.left_at) throw notFound();
};
const leader = (context: ManagementContext) => {
  if (context.own.id !== context.ride.leader_member_id)
    throw new ApiError(403, 'FORBIDDEN', 'Only the current ride leader can make this change.');
};
function revision(context: ManagementContext, expected: number) {
  if (integer(context.ride.revision) !== expected)
    throw new ApiError(412, 'REVISION_CONFLICT', 'This ride changed. Reload it before continuing.');
}
async function clock(client: PoolClient): Promise<Date> {
  return (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
}

export async function stationary(
  client: PoolClient,
  memberId: string,
  change: MotionContext,
): Promise<void> {
  const now = (await clock(client)).getTime();
  const capture = Date.parse(change.capturedAt);
  const observation = Date.parse(change.motion.observedAt);
  if (
    change.motion.state !== 'stopped' ||
    change.motion.source === 'unavailable' ||
    !Number.isFinite(capture) ||
    !Number.isFinite(observation) ||
    observation > capture ||
    capture - observation > 30000 ||
    capture > now + 5000 ||
    now - capture > 30000 ||
    now - observation > 30000
  )
    throw conflict('MOTION_RESTRICTED', 'Wait until stopped and obtain a fresh motion check.');
  const telemetry = await client.query(
    `SELECT 1 FROM ridr.location_latest l JOIN ridr.location_samples s ON s.id = l.sample_id
       AND s.membership_id = l.membership_id
     WHERE l.membership_id = $1 AND s.captured_at >= clock_timestamp() - interval '30 seconds'
       AND s.captured_at <= clock_timestamp() + interval '5 seconds' AND s.accuracy_m <= 50
       AND s.speed_mps >= (3.0 / 3.6)`,
    [memberId],
  );
  if (telemetry.rowCount)
    throw conflict(
      'MOTION_RESTRICTED',
      'The latest motion reading does not confirm you are stopped.',
    );
}

async function updateRide(
  context: ManagementContext,
  set: string,
  values: unknown[] = [],
): Promise<RideRow> {
  const result = await context.client.query<RideRow>(
    `UPDATE ridr.rides SET ${set}, revision = revision + 1 WHERE id = $1 RETURNING *`,
    [context.ride.id, ...values],
  );
  context.ride = result.rows[0]!;
  return context.ride;
}
async function event(context: ManagementContext, kind: string, payload: object): Promise<void> {
  await context.client.query(
    `WITH advanced AS (UPDATE ridr.rides SET event_sequence = event_sequence + 1 WHERE id = $1 RETURNING event_sequence)
     INSERT INTO ridr.outbox_events (id, ride_id, sequence, actor_member_id, kind, payload)
     SELECT $2, $1, event_sequence, $3, $4, $5::jsonb FROM advanced`,
    [context.ride.id, randomUUID(), context.own.id, kind, JSON.stringify(payload)],
  );
}
async function cancelPending(context: ManagementContext): Promise<void> {
  await context.client.query(
    `UPDATE ridr.consent_requests SET canceled_at = clock_timestamp()
     WHERE ride_id = $1 AND accepted_at IS NULL AND canceled_at IS NULL`,
    [context.ride.id],
  );
}

// Pair and round locks follow the ride and all participant profile/membership locks.
async function clearPairs(context: ManagementContext, memberId?: string): Promise<void> {
  const { client, ride } = context;
  const pairs = await client.query<{ id: string }>(
    `SELECT id FROM ridr.pairs WHERE ride_id = $1 AND ended_at IS NULL
     AND ($2::uuid IS NULL OR rider_member_id = $2 OR pillion_member_id = $2) ORDER BY id FOR UPDATE`,
    [ride.id, memberId ?? null],
  );
  const ids = pairs.rows.map((pair) => pair.id);
  if (!ids.length) return;
  await client.query(
    'SELECT id FROM ridr.headcount_rounds WHERE ride_id = $1 ORDER BY id FOR UPDATE',
    [ride.id],
  );
  await client.query(
    'UPDATE ridr.readiness SET invalidated_at = clock_timestamp() WHERE pair_id = ANY($1::uuid[]) AND invalidated_at IS NULL',
    [ids],
  );
  await client.query('DELETE FROM ridr.active_pair_members WHERE pair_id = ANY($1::uuid[])', [ids]);
  await client.query(
    'UPDATE ridr.pairs SET ended_at = clock_timestamp(), revision = revision + 1 WHERE id = ANY($1::uuid[])',
    [ids],
  );
  await client.query('DELETE FROM ridr.headcount_confirmations WHERE pair_id = ANY($1::uuid[])', [
    ids,
  ]);
  await client.query(
    `UPDATE ridr.scan_challenges SET expires_at = clock_timestamp()
    WHERE pair_id = ANY($1::uuid[]) AND consumed_at IS NULL AND expires_at > clock_timestamp() AND created_at < clock_timestamp()`,
    [ids],
  );
  await client.query(
    'UPDATE ridr.rides SET pairing_revision = pairing_revision + 1 WHERE id = $1',
    [ride.id],
  );
  await client.query(
    `UPDATE ridr.headcount_rounds SET revision = revision + 1,
    pairing_revision = (SELECT pairing_revision FROM ridr.rides WHERE id = $1)
    WHERE ride_id = $1 AND completed_at IS NULL`,
    [ride.id],
  );
}

export async function startRide(context: ManagementContext, change: StartRide): Promise<Ride> {
  current(context);
  leader(context);
  revision(context, change.revision);
  if (context.ride.state !== 'lobby')
    throw conflict('STATE_CONFLICT', 'Only a lobby ride can be started.');
  await stationary(context.client, context.own.id, change);
  const { client, ride } = context;
  const active = context.members.filter((member) => !member.left_at);
  if (active.length > 50) throw conflict('RIDE_FULL', 'This ride exceeds the 50-person limit.');
  const unavailable = await client.query(
    `SELECT 1 FROM ridr.profiles p JOIN ridr.memberships m ON m.user_id = p.id
    WHERE m.ride_id = $1 AND m.left_at IS NULL AND (p.account_state <> 'active' OR p.deleted_at IS NOT NULL)`,
    [ride.id],
  );
  if (unavailable.rowCount)
    throw conflict(
      'MEMBER_UNAVAILABLE',
      'An unavailable member must leave before the ride starts.',
    );
  const claims = await client.query(
    'SELECT 1 FROM ridr.active_memberships WHERE user_id = ANY($1::uuid[])',
    [active.map((member) => member.user_id)],
  );
  if (claims.rowCount)
    throw conflict('ACTIVE_RIDE_CONFLICT', 'A participant already belongs to an active ride.');
  await client.query(
    'SELECT id FROM ridr.pairs WHERE ride_id = $1 AND ended_at IS NULL ORDER BY id FOR UPDATE',
    [ride.id],
  );
  const unready = (await pairStatuses(context))
    .filter((pair) => !pair.ready)
    .map((pair) => pair.id);
  if (unready.length)
    throw new ApiError(
      409,
      'PAIR_NOT_READY',
      'Every current pair must complete readiness before start.',
      { pairIds: unready.join(',') },
    );
  await client.query(
    `INSERT INTO ridr.active_memberships (user_id, membership_id, ride_id)
    SELECT user_id, id, ride_id FROM ridr.memberships WHERE ride_id = $1 AND left_at IS NULL ORDER BY user_id`,
    [ride.id],
  );
  await updateRide(context, "state = 'active', started_at = clock_timestamp()");
  await cancelPending(context);
  await event(context, 'ride.started', { revision: integer(context.ride.revision) });
  return rideProjection(context.ride);
}

async function closePeriod(
  client: PoolClient,
  member: MemberRow,
  stoppedAt: string,
  epoch: number,
  now: Date,
): Promise<Date> {
  const cutoff = new Date(Math.min(Date.parse(stoppedAt), now.getTime()));
  const period = await client.query<{ started_at: Date }>(
    'SELECT started_at FROM ridr.sharing_periods WHERE membership_id = $1 AND epoch = $2 FOR UPDATE',
    [member.id, epoch],
  );
  if (
    !Number.isFinite(cutoff.getTime()) ||
    cutoff < (period.rows[0]?.started_at ?? member.joined_at)
  )
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'The stop time must belong to this consent interval.',
    );
  await client.query(
    'UPDATE ridr.sharing_periods SET stopped_at = GREATEST(started_at, LEAST(coalesce(stopped_at, $3::timestamptz), $3::timestamptz)) WHERE membership_id = $1 AND epoch = $2',
    [member.id, epoch, cutoff],
  );
  return cutoff;
}

async function stopMember(
  context: ManagementContext,
  member: MemberRow,
  stoppedAt: string,
  epoch: number,
): Promise<SharingState> {
  const { client } = context;
  const now = await clock(client);
  if (epoch > integer(member.consent_epoch))
    throw conflict('CONSENT_CONFLICT', 'Reload your current sharing state.');
  if (epoch < integer(member.consent_epoch))
    return {
      enabled: member.sharing,
      consentEpoch: integer(member.consent_epoch),
      revision: integer(member.revision),
      effectiveAt: now.toISOString(),
    };
  const cutoff = await closePeriod(client, member, stoppedAt, epoch, now);
  const result = await client.query<MemberRow>(
    'UPDATE ridr.memberships SET sharing = false, consent_epoch = consent_epoch + 1, revision = revision + 1 WHERE id = $1 RETURNING *',
    [member.id],
  );
  Object.assign(member, result.rows[0]);
  await client.query(
    'UPDATE ridr.status_links SET revoked_at = clock_timestamp() WHERE owner_member_id = $1 AND revoked_at IS NULL',
    [member.id],
  );
  await client.query('DELETE FROM ridr.location_latest WHERE membership_id = $1', [member.id]);
  return {
    enabled: false,
    consentEpoch: integer(member.consent_epoch),
    revision: integer(member.revision),
    effectiveAt: cutoff.toISOString(),
  };
}

export async function stopSharing(
  context: ManagementContext,
  change: StopSharing,
): Promise<SharingState> {
  // A privacy command can reconcile after leave/end without reopening live access.
  const previousRevision = integer(context.own.revision);
  const result = await stopMember(context, context.own, change.stoppedAt, change.consentEpoch);
  if (result.revision !== previousRevision)
    await event(context, 'sharing.stopped', {
      memberId: context.own.id,
      revision: result.revision,
    });
  return result;
}

export async function leaveRide(
  context: ManagementContext,
  change: StopSharing,
): Promise<LeftRide> {
  if (context.own.left_at)
    return { leftAt: context.own.left_at.toISOString(), revision: integer(context.own.revision) };
  current(context);
  if (context.own.id === context.ride.leader_member_id)
    throw conflict(
      'LEADER_MUST_TRANSFER_OR_END',
      'Transfer leadership or end the ride before leaving.',
    );
  const now = await clock(context.client);
  // Leaving revokes membership even when this privacy action captured an older consent epoch.
  if (change.consentEpoch === integer(context.own.consent_epoch))
    await closePeriod(context.client, context.own, change.stoppedAt, change.consentEpoch, now);
  else if (change.consentEpoch > integer(context.own.consent_epoch))
    throw conflict('CONSENT_CONFLICT', 'Reload your current sharing state.');
  const { client, own } = context;
  await client.query(
    'UPDATE ridr.sharing_periods SET stopped_at = $2 WHERE membership_id = $1 AND stopped_at IS NULL',
    [own.id, now],
  );
  await client.query(
    'UPDATE ridr.status_links SET revoked_at = $2 WHERE owner_member_id = $1 AND revoked_at IS NULL',
    [own.id, now],
  );
  await client.query('DELETE FROM ridr.location_latest WHERE membership_id = $1', [own.id]);
  await clearPairs(context, own.id);
  await cancelPending(context);
  await client.query('DELETE FROM ridr.active_memberships WHERE membership_id = $1', [own.id]);
  const updated = await client.query<MemberRow>(
    'UPDATE ridr.memberships SET left_at = clock_timestamp(), sharing = false, consent_epoch = consent_epoch + 1, revision = revision + 1 WHERE id = $1 RETURNING *',
    [own.id],
  );
  await updateRide(context, 'name = name');
  const result = {
    leftAt: updated.rows[0]!.left_at!.toISOString(),
    revision: integer(updated.rows[0]!.revision),
  };
  await event(context, 'member.left', {
    memberId: own.id,
    revision: integer(context.ride.revision),
  });
  return result;
}

export async function endRide(context: ManagementContext, change: EndRide): Promise<Ride> {
  leader(context);
  if (context.ride.state === 'ended') return rideProjection(context.ride);
  current(context);
  if (
    (context.ride.state === 'lobby' && change.reason !== 'cancelled') ||
    (context.ride.state === 'active' && change.reason !== 'completed')
  )
    throw conflict('STATE_CONFLICT', 'Cancel a lobby ride or complete an active ride.');
  const { client, ride, own } = context;
  if (change.consentEpoch === integer(own.consent_epoch))
    await closePeriod(client, own, change.capturedAt, change.consentEpoch, await clock(client));
  await updateRide(context, "state = 'ended', ended_at = clock_timestamp()");
  const endedAt = context.ride.ended_at!;
  await client.query(
    `UPDATE ridr.sharing_periods SET stopped_at = $2 WHERE membership_id IN
    (SELECT id FROM ridr.memberships WHERE ride_id = $1) AND stopped_at IS NULL`,
    [ride.id, endedAt],
  );
  await client.query(
    'UPDATE ridr.memberships SET sharing = false, consent_epoch = consent_epoch + 1, revision = revision + 1 WHERE ride_id = $1 AND left_at IS NULL',
    [ride.id],
  );
  await client.query('DELETE FROM ridr.active_memberships WHERE ride_id = $1', [ride.id]);
  await client.query(
    'DELETE FROM ridr.location_latest WHERE membership_id IN (SELECT id FROM ridr.memberships WHERE ride_id = $1)',
    [ride.id],
  );
  await client.query(
    'UPDATE ridr.invitations SET revoked_at = $2 WHERE ride_id = $1 AND revoked_at IS NULL',
    [ride.id, endedAt],
  );
  await client.query(
    'UPDATE ridr.status_links SET revoked_at = $2 WHERE ride_id = $1 AND revoked_at IS NULL',
    [ride.id, endedAt],
  );
  await clearPairs(context);
  await cancelPending(context);
  await event(context, 'ride.ended', {
    revision: integer(context.ride.revision),
    endedAt: endedAt.toISOString(),
    reason: change.reason,
  });
  return rideProjection(context.ride);
}

function validProposal(context: ManagementContext, proposal: ProposalRow, now: Date): boolean {
  const requester = context.members.find(
    (member) => member.id === proposal.requester_member_id && !member.left_at,
  );
  const target = context.members.find(
    (member) => member.id === proposal.target_member_id && !member.left_at,
  );
  return (
    !proposal.accepted_at &&
    !proposal.canceled_at &&
    proposal.expires_at > now &&
    !!requester &&
    !!target &&
    context.ride.state !== 'ended' &&
    proposal.payload.state === context.ride.state &&
    proposal.payload.rideRevision === integer(context.ride.revision) &&
    requester.id === context.ride.leader_member_id &&
    proposal.payload.requesterRevision === integer(requester.revision) &&
    proposal.payload.targetRevision === integer(target.revision)
  );
}

export async function propose(
  context: ManagementContext,
  kind: ProposalKind,
  change: ProposeChange,
): Promise<ProposedChange> {
  current(context);
  leader(context);
  revision(context, change.revision);
  await stationary(context.client, context.own.id, change);
  const target = context.members.find(
    (member) => member.id === change.targetMemberId && !member.left_at,
  );
  if (!target) throw notFound();
  if (target.id === context.own.id)
    throw conflict('PROPOSAL_INVALID', 'Choose another current member.');
  if (kind === 'leadership' && target.physical_role !== 'rider')
    throw conflict('PROPOSAL_INVALID', 'A pillion must first accept a Rider role change.');
  if (
    kind === 'role_change' &&
    (!change.physicalRole ||
      change.physicalRole === target.physical_role ||
      (change.physicalRole === 'pillion' && context.ride.transport !== 'motorcycle'))
  )
    throw conflict('PROPOSAL_INVALID', 'Choose a different role available for this ride.');
  const payload = {
    rideRevision: integer(context.ride.revision),
    state: context.ride.state,
    requesterRevision: integer(context.own.revision),
    targetRevision: integer(target.revision),
    physicalRole: kind === 'role_change' ? change.physicalRole! : null,
  };
  await context.client.query(
    `UPDATE ridr.consent_requests SET canceled_at = clock_timestamp()
    WHERE ride_id = $1 AND kind = $2 AND target_member_id = $3 AND accepted_at IS NULL AND canceled_at IS NULL`,
    [context.ride.id, kind, target.id],
  );
  const result = await context.client.query<{ id: string; expires_at: Date }>(
    `INSERT INTO ridr.consent_requests (id, ride_id, requester_member_id, target_member_id, kind, payload, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now() + interval '5 minutes') RETURNING id, expires_at`,
    [randomUUID(), context.ride.id, context.own.id, target.id, kind, JSON.stringify(payload)],
  );
  return { proposalId: result.rows[0]!.id, expiresAt: result.rows[0]!.expires_at.toISOString() };
}

async function proposalById(
  context: ManagementContext,
  id: string,
  kind: ProposalKind,
): Promise<ProposalRow> {
  const result = await context.client.query<ProposalRow>(
    'SELECT * FROM ridr.consent_requests WHERE id = $1 AND ride_id = $2 AND kind = $3 FOR UPDATE',
    [id, context.ride.id, kind],
  );
  if (!result.rows[0]) throw notFound();
  return result.rows[0];
}

export async function accept(
  context: ManagementContext,
  id: string,
  kind: ProposalKind,
  change: AcceptChange,
): Promise<Ride | Membership> {
  current(context);
  const proposal = await proposalById(context, id, kind);
  if (proposal.target_member_id !== context.own.id)
    throw new ApiError(403, 'FORBIDDEN', 'Only the named member can accept this proposal.');
  if (!validProposal(context, proposal, await clock(context.client)))
    throw conflict('PROPOSAL_STALE', 'This proposal has expired or the ride changed.');
  await stationary(context.client, context.own.id, change);
  const { client, own } = context;
  if (kind === 'role_change') {
    if (
      !proposal.payload.physicalRole ||
      (proposal.payload.physicalRole === 'pillion' &&
        (context.ride.transport !== 'motorcycle' || own.id === context.ride.leader_member_id))
    )
      throw conflict('PROPOSAL_STALE', 'This role change is no longer available.');
    await clearPairs(context, own.id);
    const result = await client.query<MemberRow>(
      'UPDATE ridr.memberships SET physical_role = $2, revision = revision + 1 WHERE id = $1 RETURNING *',
      [own.id, proposal.payload.physicalRole],
    );
    Object.assign(own, result.rows[0]);
    await updateRide(context, 'name = name');
  } else {
    if (own.physical_role !== 'rider')
      throw conflict('PROPOSAL_STALE', 'Leadership requires a current Rider.');
    await client.query(
      'UPDATE ridr.memberships SET revision = revision + 1 WHERE id = ANY($1::uuid[])',
      [[own.id, proposal.requester_member_id]],
    );
    await updateRide(context, 'leader_member_id = $2', [own.id]);
    // Existing pair/readiness survives. Open headcount scans belonged to the former leader.
    await client.query(
      'SELECT id FROM ridr.headcount_rounds WHERE ride_id = $1 ORDER BY id FOR UPDATE',
      [context.ride.id],
    );
    await client.query(
      `DELETE FROM ridr.headcount_confirmations WHERE round_id IN
      (SELECT id FROM ridr.headcount_rounds WHERE ride_id = $1 AND completed_at IS NULL)`,
      [context.ride.id],
    );
    await client.query(
      'UPDATE ridr.headcount_rounds SET leader_member_id = $2, revision = revision + 1 WHERE ride_id = $1 AND completed_at IS NULL',
      [context.ride.id, own.id],
    );
  }
  await client.query(
    'UPDATE ridr.consent_requests SET accepted_at = clock_timestamp() WHERE id = $1',
    [id],
  );
  await cancelPending(context);
  await event(context, kind === 'leadership' ? 'ride.leader_changed' : 'member.role_changed', {
    memberId: own.id,
    revision: integer(context.ride.revision),
  });
  return kind === 'leadership' ? rideProjection(context.ride) : memberProjection(own, context.ride);
}

export async function cancel(
  context: ManagementContext,
  id: string,
  kind: ProposalKind,
): Promise<void> {
  const proposal = await proposalById(context, id, kind);
  if (
    proposal.requester_member_id !== context.own.id &&
    proposal.target_member_id !== context.own.id
  )
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the proposer or named member can cancel this proposal.',
    );
  if (!proposal.accepted_at && !proposal.canceled_at)
    await context.client.query(
      'UPDATE ridr.consent_requests SET canceled_at = clock_timestamp() WHERE id = $1',
      [id],
    );
}

export async function management(context: ManagementContext): Promise<RideManagement> {
  const result: RideManagement = {
    ride: rideProjection(context.ride),
    membership: memberProjection(context.own, context.ride),
    proposals: [],
  };
  if (context.ride.state === 'ended' || context.own.left_at) return result;
  const proposals = await context.client.query<ProposalRow>(
    `SELECT * FROM ridr.consent_requests WHERE ride_id = $1 AND kind IN ('role_change','leadership')
     AND (requester_member_id = $2 OR target_member_id = $2) AND accepted_at IS NULL
     AND canceled_at IS NULL AND expires_at > clock_timestamp() ORDER BY created_at, id`,
    [context.ride.id, context.own.id],
  );
  const now = await clock(context.client);
  result.proposals = proposals.rows
    .filter((proposal) => validProposal(context, proposal, now))
    .map((proposal) => ({
      id: proposal.id,
      kind: proposal.kind,
      requesterMemberId: proposal.requester_member_id,
      targetMemberId: proposal.target_member_id,
      physicalRole: proposal.payload.physicalRole,
      expiresAt: proposal.expires_at.toISOString(),
    }));
  return result;
}
