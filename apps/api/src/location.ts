import { randomUUID } from 'node:crypto';
import { ApiError } from './api-errors.js';
import { UUID } from './auth.js';
import type { ManagementContext } from './ride-management.js';
import { integer } from './ride-records.js';
import type { SharingState } from './ride-types.js';

export interface LocationSample {
  v: 1;
  type: 'location.sample';
  id: string;
  rideId: string;
  capturedAt: string;
  payload: {
    consentEpoch: number;
    position: { lat: number; lon: number; accuracyM: number; recordedAt: string };
    speedKph: number | null;
    headingDegrees: number | null;
    batteryPercent: number | null;
  };
}
export interface LocationAck {
  v: 1;
  type: 'server.ack';
  id: string;
  eventId: string;
  rideId: string;
  status: 'accepted' | 'duplicate';
  serverTime: string;
  sequence: number;
}
export interface LiveLocations {
  serverTime: string;
  sequence: number;
  items: {
    memberId: string;
    sampleId: string;
    position: LocationSample['payload']['position'];
    speedKph: number | null;
    headingDegrees: number | null;
    freshness: 'fresh' | 'degraded' | 'stale';
  }[];
}
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Provide a valid location sample.');
export function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys.sort().join(',')
  )
    throw invalid();
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
export function parseSample(value: unknown): LocationSample {
  const event = exactObject(value, ['v', 'type', 'id', 'rideId', 'capturedAt', 'payload']);
  const payload = exactObject(event.payload, [
    'consentEpoch',
    'position',
    'speedKph',
    'headingDegrees',
    'batteryPercent',
  ]);
  const position = exactObject(payload.position, ['lat', 'lon', 'accuracyM', 'recordedAt']);
  if (
    event.v !== 1 ||
    event.type !== 'location.sample' ||
    typeof event.id !== 'string' ||
    !UUID.test(event.id) ||
    typeof event.rideId !== 'string' ||
    !UUID.test(event.rideId) ||
    typeof event.capturedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(event.capturedAt) ||
    !Number.isFinite(Date.parse(event.capturedAt)) ||
    new Date(event.capturedAt).toISOString().slice(0, 19) !== event.capturedAt.slice(0, 19) ||
    position.recordedAt !== event.capturedAt ||
    !number(position.lat, -90, 90) ||
    !number(position.lon, -180, 180) ||
    !number(position.accuracyM, 0, 100000) ||
    !Number.isSafeInteger(payload.consentEpoch) ||
    Number(payload.consentEpoch) < 1 ||
    !(payload.speedKph === null || number(payload.speedKph, 0, 500)) ||
    !(
      payload.headingDegrees === null ||
      (number(payload.headingDegrees, 0, 360) && payload.headingDegrees < 360)
    ) ||
    !(
      payload.batteryPercent === null ||
      (number(payload.batteryPercent, 0, 100) && Number.isInteger(payload.batteryPercent))
    )
  )
    throw invalid();
  // Canonical field order makes retry digests independent of JSON property order.
  return {
    v: 1,
    type: 'location.sample',
    id: event.id.toLowerCase(),
    rideId: event.rideId.toLowerCase(),
    capturedAt: new Date(event.capturedAt).toISOString(),
    payload: {
      consentEpoch: Number(payload.consentEpoch),
      position: {
        lat: position.lat,
        lon: position.lon,
        accuracyM: position.accuracyM,
        recordedAt: new Date(event.capturedAt).toISOString(),
      },
      speedKph: payload.speedKph as number | null,
      headingDegrees: payload.headingDegrees as number | null,
      batteryPercent: payload.batteryPercent as number | null,
    },
  };
}
function active(context: ManagementContext) {
  if (context.own.left_at || context.ride.state === 'ended')
    throw new ApiError(404, 'NOT_FOUND', 'Ride unavailable.');
  if (context.ride.state !== 'active')
    throw new ApiError(409, 'STATE_CONFLICT', 'Start the ride first.');
}
export async function enableSharing(
  context: ManagementContext,
  revision: number,
): Promise<SharingState> {
  active(context);
  const { client, own } = context;
  if (integer(own.revision) !== revision)
    throw new ApiError(412, 'REVISION_CONFLICT', 'Reload your sharing state.');
  if (own.sharing) throw new ApiError(409, 'STATE_CONFLICT', 'Sharing is already enabled.');
  const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
  const epoch = integer(own.consent_epoch) + 1;
  await client.query(
    'INSERT INTO ridr.sharing_periods (membership_id,epoch,started_at) VALUES ($1,$2,$3)',
    [own.id, epoch, now],
  );
  await client.query(
    'UPDATE ridr.memberships SET sharing=true, consent_epoch=$2, revision=revision+1 WHERE id=$1',
    [own.id, epoch],
  );
  const sequence = integer(
    (
      await client.query<{ event_sequence: string }>(
        'UPDATE ridr.rides SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence',
        [context.ride.id],
      )
    ).rows[0]!.event_sequence,
  );
  await client.query(
    'INSERT INTO ridr.outbox_events (id,ride_id,sequence,actor_member_id,kind,payload) VALUES ($1,$2,$3,$4,$5,$6)',
    [
      randomUUID(),
      context.ride.id,
      sequence,
      own.id,
      'sharing.enabled',
      JSON.stringify({ memberId: own.id, revision: integer(own.revision) + 1 }),
    ],
  );
  return {
    enabled: true,
    consentEpoch: epoch,
    revision: integer(own.revision) + 1,
    effectiveAt: now.toISOString(),
  };
}
export async function writeSample(
  context: ManagementContext,
  deviceId: string,
  sample: LocationSample,
  historical: boolean,
): Promise<LocationAck> {
  const { client, own, ride } = context;
  if (!historical) active(context);
  const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
  const captured = new Date(sample.capturedAt);
  if (captured.getTime() > now.getTime() + 5000)
    throw new ApiError(422, 'CLOCK_SKEW', 'Check your device clock.');
  if (now.getTime() - captured.getTime() > 86400000)
    throw new ApiError(422, 'STALE_LOCATION', 'This sample is older than 24 hours.');
  const device = await client.query(
    'SELECT 1 FROM ridr.devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
    [deviceId, own.user_id],
  );
  if (!device.rowCount) throw new ApiError(403, 'FORBIDDEN', 'Register this device first.');
  const period = await client.query(
    'SELECT 1 FROM ridr.sharing_periods WHERE membership_id=$1 AND epoch=$2 AND started_at <= $3 AND (stopped_at IS NULL OR $3 < stopped_at)',
    [own.id, sample.payload.consentEpoch, captured],
  );
  if (
    !period.rowCount ||
    captured < own.joined_at ||
    (own.left_at && captured >= own.left_at) ||
    (ride.ended_at && captured >= ride.ended_at)
  )
    throw new ApiError(409, 'CONSENT_EPOCH_STALE', 'This sample is outside its sharing period.');
  if (!historical && (!own.sharing || integer(own.consent_epoch) !== sample.payload.consentEpoch))
    throw new ApiError(409, 'SHARING_DISABLED', 'Location sharing is off.');
  const p = sample.payload;
  await client.query(
    `INSERT INTO ridr.location_samples (id,membership_id,user_id,ride_id,device_id,consent_epoch,captured_at,lat,lon,accuracy_m,speed_mps,heading_deg)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      sample.id,
      own.id,
      own.user_id,
      ride.id,
      deviceId,
      p.consentEpoch,
      captured,
      p.position.lat,
      p.position.lon,
      p.position.accuracyM,
      p.speedKph === null ? null : p.speedKph / 3.6,
      p.headingDegrees,
    ],
  );
  if (!historical && now.getTime() - captured.getTime() <= 30000) {
    await client.query(
      `INSERT INTO ridr.location_latest (membership_id,sample_id) VALUES ($1,$2)
      ON CONFLICT (membership_id) DO UPDATE SET sample_id=EXCLUDED.sample_id
      WHERE (SELECT (captured_at,id) < ($3::timestamptz,$2::uuid) FROM ridr.location_samples WHERE id=location_latest.sample_id)`,
      [own.id, sample.id, captured],
    );
  }
  const sequence = integer(
    (
      await client.query<{ event_sequence: string }>(
        'UPDATE ridr.rides SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence',
        [ride.id],
      )
    ).rows[0]!.event_sequence,
  );
  await client.query(
    `INSERT INTO ridr.outbox_events (id,ride_id,sequence,actor_member_id,kind,payload) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      randomUUID(),
      ride.id,
      sequence,
      own.id,
      historical ? 'location.history' : 'location.updated',
      JSON.stringify({ memberId: own.id, sampleId: sample.id }),
    ],
  );
  return {
    v: 1,
    type: 'server.ack',
    id: randomUUID(),
    eventId: sample.id,
    rideId: ride.id,
    status: 'accepted',
    serverTime: now.toISOString(),
    sequence,
  };
}
export async function liveLocations(context: ManagementContext): Promise<LiveLocations> {
  active(context);
  const { client, ride } = context;
  const rows = await client.query<{
    membership_id: string;
    id: string;
    captured_at: Date;
    lat: number;
    lon: number;
    accuracy_m: number;
    speed_mps: number | null;
    heading_deg: number | null;
  }>(
    `SELECT s.* FROM ridr.location_latest l JOIN ridr.location_samples s ON s.id=l.sample_id
    JOIN ridr.memberships m ON m.id=l.membership_id WHERE m.ride_id=$1 AND m.left_at IS NULL AND m.sharing AND m.consent_epoch=s.consent_epoch ORDER BY m.id`,
    [ride.id],
  );
  const now = Date.now();
  const sequence = integer(
    (
      await client.query<{ event_sequence: string }>(
        'SELECT event_sequence FROM ridr.rides WHERE id=$1',
        [ride.id],
      )
    ).rows[0]!.event_sequence,
  );
  return {
    serverTime: new Date(now).toISOString(),
    sequence,
    items: rows.rows.map((row) => ({
      memberId: row.membership_id,
      sampleId: row.id,
      position: {
        lat: row.lat,
        lon: row.lon,
        accuracyM: row.accuracy_m,
        recordedAt: row.captured_at.toISOString(),
      },
      speedKph: row.speed_mps === null ? null : row.speed_mps * 3.6,
      headingDegrees: row.heading_deg,
      freshness:
        now - row.captured_at.getTime() > 30000
          ? 'stale'
          : row.accuracy_m > 50
            ? 'degraded'
            : 'fresh',
    })),
  };
}
