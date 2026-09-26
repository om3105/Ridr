import { createHash } from 'node:crypto';
import { ApiError } from './api-errors.js';
import { UUID } from './auth.js';
import type { ManagementContext } from './ride-management.js';

export type SosPosition = { lat: number; lon: number; accuracyM: number; recordedAt: string };
export type SosRequest = {
  v: 1;
  id: string;
  rideId: string;
  type: 'sos.request';
  capturedAt: string;
  payload: { kind: 'manual'; position: SosPosition | null };
};
export type SosResolution = {
  id: string;
  kind: 'reporter_okay' | 'coordination_closed';
  reason: string | null;
  actorMemberId: string;
  acceptedAt: string;
};
export type SosView = {
  id: string;
  rideId: string;
  reporterMemberId: string;
  reporterName: string;
  deviceId: string;
  capturedAt: string;
  acceptedAt: string;
  pairSnapshot: {
    pairId: string;
    riderMemberId: string;
    riderName: string;
    pillionMemberId: string;
    pillionName: string;
  } | null;
  position: SosPosition | null;
  linkedSosIds: string[];
  resolution: SosResolution | null;
  deviceReceipts: { deviceId: string; memberName: string; receivedAt: string }[];
};
type SosRow = {
  id: string;
  ride_id: string;
  reporter_member_id: string;
  device_id: string;
  captured_at: Date;
  accepted_at: Date;
  pair_snapshot: SosView['pairSnapshot'];
  location_snapshot: SosPosition | null;
  request_hash: Buffer | null;
  reporter_name: string;
};
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Provide a valid manual SOS request.');
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const exact = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
};
export function parseSosRequest(value: unknown): SosRequest {
  const event = object(value);
  if (
    !exact(event, ['v', 'id', 'rideId', 'type', 'capturedAt', 'payload']) ||
    event.v !== 1 ||
    event.type !== 'sos.request' ||
    typeof event.id !== 'string' ||
    !UUID.test(event.id) ||
    typeof event.rideId !== 'string' ||
    !UUID.test(event.rideId) ||
    !timestamp(event.capturedAt)
  )
    throw invalid();
  const payload = object(event.payload);
  if (!exact(payload, ['kind', 'position']) || payload.kind !== 'manual') throw invalid();
  let position: SosPosition | null = null;
  if (payload.position !== null) {
    const point = object(payload.position);
    if (
      !exact(point, ['lat', 'lon', 'accuracyM', 'recordedAt']) ||
      typeof point.lat !== 'number' ||
      !Number.isFinite(point.lat) ||
      Math.abs(point.lat) > 90 ||
      typeof point.lon !== 'number' ||
      !Number.isFinite(point.lon) ||
      Math.abs(point.lon) > 180 ||
      typeof point.accuracyM !== 'number' ||
      !Number.isFinite(point.accuracyM) ||
      point.accuracyM < 0 ||
      point.accuracyM > 100000 ||
      !timestamp(point.recordedAt) ||
      Date.parse(point.recordedAt) > Date.parse(event.capturedAt) ||
      Date.parse(event.capturedAt) - Date.parse(point.recordedAt) > 600000
    )
      throw invalid();
    position = {
      lat: point.lat,
      lon: point.lon,
      accuracyM: point.accuracyM,
      recordedAt: new Date(point.recordedAt).toISOString(),
    };
  }
  return {
    v: 1,
    id: event.id.toLowerCase(),
    rideId: event.rideId.toLowerCase(),
    type: 'sos.request',
    capturedAt: new Date(event.capturedAt).toISOString(),
    payload: { kind: 'manual', position },
  };
}
export const sosDigest = (event: SosRequest) =>
  createHash('sha256').update(JSON.stringify(event)).digest();
const unavailable = () =>
  new ApiError(404, 'SOS_NOT_ACCEPTED', 'This SOS has not been accepted by the server.');
const current = (context: ManagementContext) => {
  if (context.ride.state !== 'active' || context.own.left_at)
    throw new ApiError(409, 'STATE_CONFLICT', 'SOS requires a current active ride.');
};
const readAccess = (context: ManagementContext) => {
  if (context.own.left_at && context.ride.state !== 'ended')
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
};
async function eventRow(context: ManagementContext, id: string): Promise<SosRow | null> {
  const found = await context.client.query<SosRow>(
    `SELECT s.*,p.display_name AS reporter_name FROM ridr.sos_events s
     JOIN ridr.profiles p ON p.id=s.reporter_user_id WHERE s.id=$1 AND s.ride_id=$2`,
    [id, context.ride.id],
  );
  return found.rows[0] ?? null;
}
async function projection(context: ManagementContext, row: SosRow): Promise<SosView> {
  const updates = await context.client.query<{
    id: string;
    kind: SosResolution['kind'];
    reason: string | null;
    actor_member_id: string;
    accepted_at: Date;
  }>(
    'SELECT id,kind,reason,actor_member_id,accepted_at FROM ridr.sos_updates WHERE sos_id=$1 ORDER BY accepted_at DESC,id DESC LIMIT 1',
    [row.id],
  );
  const receipts = await context.client.query<{
    device_id: string;
    display_name: string;
    acknowledged_at: Date;
  }>(
    `SELECT a.device_id,p.display_name,a.acknowledged_at FROM ridr.device_acknowledgements a
       JOIN ridr.devices d ON d.id=a.device_id JOIN ridr.profiles p ON p.id=d.user_id
       WHERE a.event_id=$1 ORDER BY a.acknowledged_at,a.device_id`,
    [row.id],
  );
  const linked = row.pair_snapshot
    ? await context.client.query<{ id: string }>(
        `SELECT id FROM ridr.sos_events WHERE ride_id=$1 AND id<>$2 AND pair_snapshot->>'pairId'=$3
       AND captured_at BETWEEN $4::timestamptz-interval '60 seconds' AND $4::timestamptz+interval '60 seconds' ORDER BY accepted_at,id`,
        [row.ride_id, row.id, row.pair_snapshot.pairId, row.captured_at],
      )
    : { rows: [] as { id: string }[] };
  const update = updates.rows[0];
  return {
    id: row.id,
    rideId: row.ride_id,
    reporterMemberId: row.reporter_member_id,
    reporterName: row.reporter_name,
    deviceId: row.device_id,
    capturedAt: row.captured_at.toISOString(),
    acceptedAt: row.accepted_at.toISOString(),
    pairSnapshot: row.pair_snapshot,
    position: row.location_snapshot,
    linkedSosIds: linked.rows.map((item) => item.id),
    resolution: update
      ? {
          id: update.id,
          kind: update.kind,
          reason: update.reason,
          actorMemberId: update.actor_member_id,
          acceptedAt: update.accepted_at.toISOString(),
        }
      : null,
    deviceReceipts: receipts.rows.map((item) => ({
      deviceId: item.device_id,
      memberName: item.display_name,
      receivedAt: item.acknowledged_at.toISOString(),
    })),
  };
}
export async function readSos(context: ManagementContext, id: string): Promise<SosView> {
  readAccess(context);
  const row = await eventRow(context, id);
  if (!row) throw unavailable();
  return projection(context, row);
}
export async function listSos(context: ManagementContext): Promise<SosView[]> {
  readAccess(context);
  const rows = await context.client.query<SosRow>(
    `SELECT s.*,p.display_name AS reporter_name FROM ridr.sos_events s
     JOIN ridr.profiles p ON p.id=s.reporter_user_id WHERE s.ride_id=$1
     ORDER BY s.accepted_at DESC,s.id DESC LIMIT 20`,
    [context.ride.id],
  );
  const views: SosView[] = [];
  for (const row of rows.rows) views.push(await projection(context, row));
  return views;
}
export async function sendSos(
  context: ManagementContext,
  event: SosRequest,
  deviceId: string,
  grantId?: string,
): Promise<SosView> {
  const digest = sosDigest(event);
  const existing = await eventRow(context, event.id);
  if (existing) {
    if (existing.reporter_member_id !== context.own.id || !existing.request_hash?.equals(digest))
      throw new ApiError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This SOS ID belongs to a different request.',
      );
    return projection(context, existing);
  }
  current(context);
  const now = (await context.client.query<{ now: Date }>('SELECT clock_timestamp() AS now'))
    .rows[0]!.now;
  const age = now.getTime() - Date.parse(event.capturedAt);
  if (
    age < -5000 ||
    age > 86400000 ||
    Date.parse(event.capturedAt) < context.own.joined_at.getTime() ||
    (context.ride.started_at && Date.parse(event.capturedAt) < context.ride.started_at.getTime())
  )
    throw new ApiError(409, 'SOS_EXPIRED', 'This SOS capture time is no longer valid.');
  if (age > 60000) {
    if (!grantId)
      throw new ApiError(409, 'RECONFIRMATION_REQUIRED', 'Confirm that help is still needed.');
    const grant = await context.client.query<{
      operation: string;
      result: {
        grant: { eventId: string; digest: string; expiresAt: string; consumedAt?: string } | null;
      };
    }>(
      'SELECT operation,result FROM ridr.command_receipts WHERE actor_id=$1 AND command_id=$2 FOR UPDATE',
      [context.own.user_id, grantId],
    );
    const row = grant.rows[0];
    const grantValue = row?.result?.grant;
    if (
      row?.operation !== `POST /v1/rides/${context.ride.id}/sos/${event.id}/reconfirm` ||
      grantValue?.eventId !== event.id ||
      grantValue?.digest !== digest.toString('hex') ||
      grantValue?.consumedAt ||
      Date.parse(grantValue.expiresAt) < now.getTime()
    )
      throw new ApiError(409, 'RECONFIRMATION_REQUIRED', 'Confirm that help is still needed.');
    await context.client.query(
      `UPDATE ridr.command_receipts SET result=jsonb_set(result,'{grant,consumedAt}',to_jsonb(clock_timestamp()::text)) WHERE actor_id=$1 AND command_id=$2`,
      [context.own.user_id, grantId],
    );
  }
  const device = await context.client.query(
    'SELECT 1 FROM ridr.devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
    [deviceId, context.own.user_id],
  );
  if (!device.rowCount)
    throw new ApiError(403, 'FORBIDDEN', 'Register this device before requesting help.');
  const pair = await context.client.query<{
    id: string;
    rider_member_id: string;
    pillion_member_id: string;
    rider_name: string;
    pillion_name: string;
  }>(
    `SELECT pair.id,pair.rider_member_id,pair.pillion_member_id,rp.display_name AS rider_name,pp.display_name AS pillion_name
     FROM ridr.pairs pair JOIN ridr.memberships rm ON rm.id=pair.rider_member_id JOIN ridr.profiles rp ON rp.id=rm.user_id
     JOIN ridr.memberships pm ON pm.id=pair.pillion_member_id JOIN ridr.profiles pp ON pp.id=pm.user_id
     WHERE pair.ride_id=$1 AND (pair.rider_member_id=$2 OR pair.pillion_member_id=$2)
       AND pair.created_at<=$3 AND (pair.ended_at IS NULL OR pair.ended_at>$3)
     ORDER BY pair.created_at DESC LIMIT 1`,
    [context.ride.id, context.own.id, event.capturedAt],
  );
  const p = pair.rows[0];
  const snapshot = p
    ? {
        pairId: p.id,
        riderMemberId: p.rider_member_id,
        riderName: p.rider_name,
        pillionMemberId: p.pillion_member_id,
        pillionName: p.pillion_name,
      }
    : null;
  const inserted = await context.client.query<SosRow>(
    `INSERT INTO ridr.sos_events(id,ride_id,reporter_member_id,reporter_user_id,device_id,source,captured_at,pair_snapshot,location_snapshot,request_hash)
     VALUES ($1,$2,$3,$4,$5,'manual',$6,$7::jsonb,$8::jsonb,$9) RETURNING *`,
    [
      event.id,
      context.ride.id,
      context.own.id,
      context.own.user_id,
      deviceId,
      event.capturedAt,
      snapshot ? JSON.stringify(snapshot) : null,
      event.payload.position ? JSON.stringify(event.payload.position) : null,
      digest,
    ],
  );
  const sequence = (
    await context.client.query<{ event_sequence: string }>(
      'UPDATE ridr.rides SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence',
      [context.ride.id],
    )
  ).rows[0]!.event_sequence;
  await context.client.query(
    `INSERT INTO ridr.outbox_events(id,ride_id,sequence,actor_member_id,kind,payload) VALUES ($1,$2,$3,$4,'sos.accepted',$5::jsonb)`,
    [event.id, context.ride.id, sequence, context.own.id, JSON.stringify({ sosId: event.id })],
  );
  return projection(context, { ...inserted.rows[0]!, reporter_name: context.own.display_name });
}
export async function reconfirmSos(
  context: ManagementContext,
  event: SosRequest,
  grantId: string,
  confirmedAt: string,
) {
  const accepted = await eventRow(context, event.id);
  if (accepted) {
    if (
      accepted.reporter_member_id !== context.own.id ||
      !accepted.request_hash?.equals(sosDigest(event))
    )
      throw new ApiError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This SOS ID belongs to a different request.',
      );
    return { accepted: await projection(context, accepted), grant: null };
  }
  current(context);
  const now = (await context.client.query<{ now: Date }>('SELECT clock_timestamp() AS now'))
    .rows[0]!.now;
  if (
    Math.abs(now.getTime() - Date.parse(confirmedAt)) > 30000 ||
    now.getTime() - Date.parse(event.capturedAt) > 86400000
  )
    throw new ApiError(409, 'RECONFIRMATION_REQUIRED', 'Confirm that help is still needed now.');
  return {
    accepted: null,
    grant: {
      grantId,
      eventId: event.id,
      digest: sosDigest(event).toString('hex'),
      expiresAt: new Date(now.getTime() + 30000).toISOString(),
    },
  };
}
export async function resolveSos(
  context: ManagementContext,
  sosId: string,
  change: { id: string; kind: 'reporter_okay' | 'coordination_closed'; reason: string | null },
) {
  current(context);
  const sos = await eventRow(context, sosId);
  if (!sos) throw unavailable();
  if (change.kind === 'reporter_okay' && sos.reporter_member_id !== context.own.id)
    throw new ApiError(403, 'FORBIDDEN', 'Only the reporter can say they are okay.');
  if (change.kind === 'coordination_closed' && context.ride.leader_member_id !== context.own.id)
    throw new ApiError(403, 'FORBIDDEN', 'Only the leader can close coordination.');
  await context.client.query(
    'INSERT INTO ridr.sos_updates(id,ride_id,sos_id,actor_member_id,kind,reason) VALUES ($1,$2,$3,$4,$5,$6)',
    [change.id, context.ride.id, sosId, context.own.id, change.kind, change.reason],
  );
  const sequence = (
    await context.client.query<{ event_sequence: string }>(
      'UPDATE ridr.rides SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence',
      [context.ride.id],
    )
  ).rows[0]!.event_sequence;
  await context.client.query(
    `INSERT INTO ridr.outbox_events(id,ride_id,sequence,actor_member_id,kind,payload)
    VALUES ($1,$2,$3,$4,'sos.resolved',$5::jsonb)`,
    [
      change.id,
      context.ride.id,
      sequence,
      context.own.id,
      JSON.stringify({ sosId, kind: change.kind }),
    ],
  );
  return readSos(context, sosId);
}
export async function acknowledgeSos(
  context: ManagementContext,
  sosId: string,
  deviceId: string,
  receivedAt: string,
) {
  readAccess(context);
  if (!timestamp(receivedAt) || Math.abs(Date.now() - Date.parse(receivedAt)) > 300000)
    throw invalid();
  const sos = await eventRow(context, sosId);
  if (!sos) throw unavailable();
  const device = await context.client.query(
    'SELECT 1 FROM ridr.devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
    [deviceId, context.own.user_id],
  );
  if (!device.rowCount)
    throw new ApiError(403, 'FORBIDDEN', 'This device is not registered to your account.');
  await context.client.query(
    `INSERT INTO ridr.device_acknowledgements(event_id,device_id,acknowledged_at,reported_received_at)
    VALUES ($1,$2,clock_timestamp(),$3) ON CONFLICT (event_id,device_id) DO NOTHING`,
    [sosId, deviceId, receivedAt],
  );
  return readSos(context, sosId);
}
