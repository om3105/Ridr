import { ApiError } from './api-errors.js';
import { UUID } from './auth.js';
import type { ManagementContext } from './ride-management.js';
export interface TrailPage {
  rideId: string;
  memberId: string;
  points: {
    id: string;
    capturedAt: string;
    lat: number;
    lon: number;
    accuracyM: number;
    consentEpoch: number;
  }[];
  nextCursor: string | null;
}
export async function readTrail(
  context: ManagementContext,
  memberId: string,
  cursor?: string,
): Promise<TrailPage> {
  const { client, own, ride, members } = context;
  const target = members.find((member) => member.id === memberId);
  const isOwn = target?.user_id === own.user_id;
  if (
    !target ||
    !ride.started_at ||
    (!isOwn && (own.left_at || ride.state !== 'active' || target.left_at || !target.sharing))
  )
    throw new ApiError(404, 'NOT_FOUND', 'Trail unavailable.');
  const epoch = isOwn ? null : Number(target.consent_epoch);
  let before: { at: string; id: string } | null = null;
  if (cursor !== undefined) {
    try {
      if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Record<
        string,
        unknown
      >;
      if (
        value.actor !== own.user_id ||
        value.ride !== ride.id ||
        value.member !== memberId ||
        value.epoch !== epoch ||
        typeof value.id !== 'string' ||
        !UUID.test(value.id) ||
        typeof value.at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.at) ||
        !Number.isFinite(Date.parse(value.at))
      )
        throw new Error();
      before = { at: value.at, id: value.id };
    } catch {
      throw new ApiError(400, 'INVALID_REQUEST', 'Invalid trail cursor. Refresh the trail.');
    }
  }
  const result = await client.query<{
    id: string;
    captured_at: Date;
    cursor_at: string;
    lat: number;
    lon: number;
    accuracy_m: number;
    consent_epoch: string;
  }>(
    `SELECT s.id,s.captured_at,to_char(s.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
      s.lat,s.lon,s.accuracy_m,s.consent_epoch
    FROM ridr.location_samples s JOIN ridr.profiles p ON p.id=s.user_id
    WHERE s.membership_id=$1 AND s.ride_id=$2 AND p.account_state='active' AND p.deleted_at IS NULL
      AND (s.expires_at IS NULL OR s.expires_at > clock_timestamp())
      AND ($3::timestamptz IS NULL OR $3::timestamptz + interval '90 days' > clock_timestamp())
      AND ($4::bigint IS NULL OR s.consent_epoch=$4)
      AND ($5::timestamptz IS NULL OR (s.captured_at,s.id) < ($5::timestamptz,$6::uuid))
    ORDER BY s.captured_at DESC,s.id DESC LIMIT 201`,
    [memberId, ride.id, ride.ended_at, epoch, before?.at ?? null, before?.id ?? null],
  );
  const rows = result.rows.slice(0, 200),
    last = rows.at(-1);
  return {
    rideId: ride.id,
    memberId,
    points: rows.map((row) => ({
      id: row.id,
      capturedAt: row.captured_at.toISOString(),
      lat: row.lat,
      lon: row.lon,
      accuracyM: row.accuracy_m,
      consentEpoch: Number(row.consent_epoch),
    })),
    nextCursor:
      result.rows.length > 200 && last
        ? Buffer.from(
            JSON.stringify({
              actor: own.user_id,
              ride: ride.id,
              member: memberId,
              epoch,
              at: last.cursor_at,
              id: last.id,
            }),
          ).toString('base64url')
        : null,
  };
}
