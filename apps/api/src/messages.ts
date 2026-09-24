import { ApiError } from './api-errors.js';
import { UUID } from './auth.js';
import { stationary, type ManagementContext } from './ride-management.js';
import { integer } from './ride-records.js';
import type { MotionContext } from './ride-types.js';

export interface MessageEvent extends MotionContext {
  v: 1;
  type: 'message.text' | 'message.pin';
  id: string;
  rideId: string;
  payload: {
    text: string;
    coordinate?: { lat: number; lon: number };
    motion: MotionContext['motion'];
  };
}
export interface RideMessage {
  id: string;
  rideId: string;
  sequence: number;
  authorMemberId: string;
  authorName: string;
  kind: 'text' | 'pin';
  text: string;
  coordinate: { lat: number; lon: number } | null;
  capturedAt: string;
  acceptedAt: string;
}
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Provide a valid ride message.');
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw invalid();
};
const time = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

export function parseMessage(value: unknown): MessageEvent {
  const event = object(value);
  exact(event, ['v', 'type', 'id', 'rideId', 'capturedAt', 'payload']);
  if (
    event.v !== 1 ||
    (event.type !== 'message.text' && event.type !== 'message.pin') ||
    typeof event.id !== 'string' ||
    !UUID.test(event.id) ||
    typeof event.rideId !== 'string' ||
    !UUID.test(event.rideId) ||
    !time(event.capturedAt)
  )
    throw invalid();
  const payload = object(event.payload);
  exact(
    payload,
    event.type === 'message.pin' ? ['text', 'coordinate', 'motion'] : ['text', 'motion'],
  );
  const motion = object(payload.motion);
  exact(motion, ['state', 'source', 'observedAt']);
  if (
    typeof payload.text !== 'string' ||
    [...payload.text].length > 1000 ||
    !payload.text.trim() ||
    [...payload.text].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    }) ||
    motion.state !== 'stopped' ||
    (motion.source !== 'speed' && motion.source !== 'activity') ||
    !time(motion.observedAt)
  )
    throw invalid();
  let coordinate: { lat: number; lon: number } | undefined;
  if (event.type === 'message.pin') {
    const point = object(payload.coordinate);
    exact(point, ['lat', 'lon']);
    if (
      typeof point.lat !== 'number' ||
      !Number.isFinite(point.lat) ||
      Math.abs(point.lat) > 90 ||
      typeof point.lon !== 'number' ||
      !Number.isFinite(point.lon) ||
      Math.abs(point.lon) > 180
    )
      throw invalid();
    coordinate = { lat: point.lat, lon: point.lon };
  }
  return {
    v: 1,
    type: event.type,
    id: event.id.toLowerCase(),
    rideId: event.rideId.toLowerCase(),
    capturedAt: new Date(event.capturedAt).toISOString(),
    motion: {
      state: 'stopped',
      source: motion.source as 'speed' | 'activity',
      observedAt: new Date(motion.observedAt as string).toISOString(),
    },
    payload: {
      text: payload.text,
      ...(coordinate ? { coordinate } : {}),
      motion: {
        state: 'stopped',
        source: motion.source as 'speed' | 'activity',
        observedAt: new Date(motion.observedAt as string).toISOString(),
      },
    },
  };
}

function active(context: ManagementContext) {
  if (context.own.left_at || context.ride.state === 'ended')
    throw new ApiError(404, 'NOT_FOUND', 'Ride unavailable.');
  if (context.ride.state !== 'active')
    throw new ApiError(409, 'STATE_CONFLICT', 'Start the ride first.');
}
interface Row {
  id: string;
  ride_id: string;
  sender_member_id: string;
  display_name: string;
  kind: 'text' | 'pin';
  body: string;
  lat: number | null;
  lon: number | null;
  captured_at: Date;
  accepted_at: Date;
  sequence: string;
}
const projection = (row: Row): RideMessage => ({
  id: row.id,
  rideId: row.ride_id,
  sequence: integer(row.sequence),
  authorMemberId: row.sender_member_id,
  authorName: row.display_name,
  kind: row.kind,
  text: row.body,
  coordinate: row.lat === null || row.lon === null ? null : { lat: row.lat, lon: row.lon },
  capturedAt: row.captured_at.toISOString(),
  acceptedAt: row.accepted_at.toISOString(),
});
const columns = `m.id,m.ride_id,m.sender_member_id,p.display_name,m.kind,m.body,m.lat,m.lon,m.captured_at,m.accepted_at,o.sequence`;

export async function sendMessage(context: ManagementContext, event: MessageEvent) {
  active(context);
  const { client, own, ride } = context;
  const existing = await client.query<Row>(
    `SELECT ${columns} FROM ridr.messages m JOIN ridr.outbox_events o ON o.id=m.id
     JOIN ridr.profiles p ON p.id=(SELECT user_id FROM ridr.memberships WHERE id=m.sender_member_id)
     WHERE m.id=$1`,
    [event.id],
  );
  if (existing.rows[0]) {
    const old = projection(existing.rows[0]);
    if (
      old.rideId !== ride.id ||
      old.authorMemberId !== own.id ||
      old.kind !== (event.type === 'message.pin' ? 'pin' : 'text') ||
      old.text !== event.payload.text ||
      old.capturedAt !== event.capturedAt ||
      JSON.stringify(old.coordinate) !== JSON.stringify(event.payload.coordinate ?? null)
    )
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This message ID was used before.');
    return old;
  }
  // The original motion proof applies to composition. Delayed active-ride replay remains
  // bounded to 24 hours; an ended ride is rejected above rather than becoming live chat.
  const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
  const captured = Date.parse(event.capturedAt),
    observed = Date.parse(event.motion.observedAt);
  if (
    captured > now.getTime() + 5000 ||
    now.getTime() - captured > 86400000 ||
    observed > captured ||
    captured - observed > 30000 ||
    captured < (ride.started_at?.getTime() ?? Infinity)
  )
    throw new ApiError(422, 'MESSAGE_EXPIRED', 'The message can no longer be sent live.');
  if (now.getTime() - captured <= 30000) await stationary(client, own.id, event);
  else {
    const moving = await client.query(
      `SELECT 1 FROM ridr.location_samples WHERE membership_id=$1 AND captured_at BETWEEN $2::timestamptz - interval '15 seconds' AND $2::timestamptz + interval '15 seconds' AND accuracy_m <= 50 AND speed_mps >= (3.0 / 3.6) LIMIT 1`,
      [own.id, event.capturedAt],
    );
    if (moving.rowCount)
      throw new ApiError(409, 'MOTION_RESTRICTED', 'A movement reading conflicts with this draft.');
  }
  const accepted = await client.query<{ event_sequence: string }>(
    'UPDATE ridr.rides SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence',
    [ride.id],
  );
  const sequence = integer(accepted.rows[0]!.event_sequence);
  await client.query(
    `INSERT INTO ridr.messages(id,ride_id,sender_member_id,kind,body,lat,lon,captured_at,accepted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      event.id,
      ride.id,
      own.id,
      event.type === 'message.pin' ? 'pin' : 'text',
      event.payload.text,
      event.payload.coordinate?.lat ?? null,
      event.payload.coordinate?.lon ?? null,
      event.capturedAt,
      now,
    ],
  );
  await client.query(
    `INSERT INTO ridr.outbox_events(id,ride_id,sequence,actor_member_id,kind,payload)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      event.id,
      ride.id,
      sequence,
      own.id,
      'message.accepted',
      JSON.stringify({ messageId: event.id }),
    ],
  );
  return {
    id: event.id,
    rideId: ride.id,
    sequence,
    authorMemberId: own.id,
    authorName: own.display_name,
    kind: event.type === 'message.pin' ? ('pin' as const) : ('text' as const),
    text: event.payload.text,
    coordinate: event.payload.coordinate ?? null,
    capturedAt: event.capturedAt,
    acceptedAt: now.toISOString(),
  };
}

export async function readMessages(
  context: ManagementContext,
  afterSequence: number,
  limit: number,
) {
  active(context);
  const result = await context.client.query<Row>(
    `SELECT ${columns} FROM ridr.messages m JOIN ridr.outbox_events o ON o.id=m.id
     JOIN ridr.memberships member ON member.id=m.sender_member_id
     JOIN ridr.profiles p ON p.id=member.user_id
     WHERE m.ride_id=$1 AND o.sequence > $2
     ORDER BY o.sequence ASC LIMIT $3`,
    [context.ride.id, afterSequence, limit + 1],
  );
  const rows = result.rows.slice(0, limit),
    items = rows.map(projection);
  return { items, nextSequence: result.rows.length > limit ? items.at(-1)!.sequence : null };
}
