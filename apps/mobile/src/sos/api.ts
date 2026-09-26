import { request, RideError, type RideClientOptions } from '../rides/api';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RideError('invalid', 'The SOS response is invalid.');
  return value as Record<string, unknown>;
};
export type SosPosition = { lat: number; lon: number; accuracyM: number; recordedAt: string };
export type SosEvent = {
  v: 1;
  id: string;
  rideId: string;
  type: 'sos.request';
  capturedAt: string;
  payload: { kind: 'manual'; position: SosPosition | null };
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
  resolution: {
    id: string;
    kind: 'reporter_okay' | 'coordination_closed';
    reason: string | null;
    actorMemberId: string;
    acceptedAt: string;
  } | null;
  deviceReceipts: { deviceId: string; memberName: string; receivedAt: string }[];
};
export function parseSos(value: unknown): SosView {
  const row = object(value);
  if (
    !uuid.test(String(row.id)) ||
    !uuid.test(String(row.rideId)) ||
    !uuid.test(String(row.reporterMemberId)) ||
    typeof row.reporterName !== 'string' ||
    !row.reporterName ||
    !uuid.test(String(row.deviceId)) ||
    !date(row.capturedAt) ||
    !date(row.acceptedAt) ||
    !Array.isArray(row.linkedSosIds) ||
    row.linkedSosIds.some((id: unknown) => !uuid.test(String(id))) ||
    !Array.isArray(row.deviceReceipts)
  )
    throw new RideError('invalid', 'The SOS response is invalid.');
  if (row.pairSnapshot !== null) {
    const pair = object(row.pairSnapshot);
    if (
      !uuid.test(String(pair.pairId)) ||
      !uuid.test(String(pair.riderMemberId)) ||
      !uuid.test(String(pair.pillionMemberId)) ||
      typeof pair.riderName !== 'string' ||
      typeof pair.pillionName !== 'string'
    )
      throw new RideError('invalid', 'The SOS pair snapshot is invalid.');
  }
  if (row.position !== null) {
    const point = object(row.position);
    if (
      typeof point.lat !== 'number' ||
      !Number.isFinite(point.lat) ||
      Math.abs(point.lat) > 90 ||
      typeof point.lon !== 'number' ||
      !Number.isFinite(point.lon) ||
      Math.abs(point.lon) > 180 ||
      typeof point.accuracyM !== 'number' ||
      !Number.isFinite(point.accuracyM) ||
      point.accuracyM < 0 ||
      !date(point.recordedAt)
    )
      throw new RideError('invalid', 'The SOS position is invalid.');
  }
  if (row.resolution !== null) {
    const resolution = object(row.resolution);
    if (
      !uuid.test(String(resolution.id)) ||
      !['reporter_okay', 'coordination_closed'].includes(String(resolution.kind)) ||
      !uuid.test(String(resolution.actorMemberId)) ||
      !date(resolution.acceptedAt)
    )
      throw new RideError('invalid', 'The SOS resolution is invalid.');
  }
  for (const item of row.deviceReceipts) {
    const receipt = object(item);
    if (
      !uuid.test(String(receipt.deviceId)) ||
      typeof receipt.memberName !== 'string' ||
      !date(receipt.receivedAt)
    )
      throw new RideError('invalid', 'The SOS device receipt is invalid.');
  }
  return row as SosView;
}
export const newSosEvent = (
  rideId: string,
  id: string,
  at = new Date().toISOString(),
  position: SosPosition | null = null,
): SosEvent => ({
  v: 1,
  id,
  rideId,
  type: 'sos.request',
  capturedAt: at,
  payload: { kind: 'manual', position },
});
export function listSos(options: RideClientOptions, rideId: string) {
  return request(options, {
    path: `/v1/rides/${rideId}/sos`,
    parse: (value) => {
      if (!Array.isArray(value) || value.length > 20)
        throw new RideError('invalid', 'The SOS list is invalid.');
      return value.map(parseSos);
    },
  });
}
export function readSos(options: RideClientOptions, event: SosEvent) {
  return request(options, {
    path: `/v1/rides/${event.rideId}/sos/${event.id}`,
    parse: (value) => {
      const row = object(value);
      if (row.status !== 'accepted')
        throw new RideError('invalid', 'SOS acceptance is unconfirmed.');
      const sos = parseSos(row.sos);
      if (sos.id !== event.id || sos.rideId !== event.rideId)
        throw new RideError('invalid', 'SOS identity did not match.');
      return sos;
    },
  });
}
export function sendSos(
  options: RideClientOptions,
  event: SosEvent,
  deviceId: string,
  grantId?: string,
) {
  return request(options, {
    path: `/v1/rides/${event.rideId}/events`,
    method: 'POST',
    body: { event },
    deviceId,
    idempotencyKey: event.id,
    ...(grantId ? { sosGrantId: grantId } : {}),
    parse: (value) => {
      const sos = parseSos(value);
      if (sos.id !== event.id || sos.rideId !== event.rideId)
        throw new RideError('invalid', 'SOS acceptance did not match.');
      return sos;
    },
  });
}
export function reconfirmSos(
  options: RideClientOptions,
  event: SosEvent,
  grantId: string,
  confirmedAt: string,
) {
  return request(options, {
    path: `/v1/rides/${event.rideId}/sos/${event.id}/reconfirm`,
    method: 'POST',
    body: { event, confirmedAt },
    idempotencyKey: grantId,
    parse: (value) => {
      const row = object(value);
      if (row.accepted !== null) return { accepted: parseSos(row.accepted), grant: null };
      const grant = object(row.grant);
      if (grant.grantId !== grantId || grant.eventId !== event.id || !date(grant.expiresAt))
        throw new RideError('invalid', 'SOS reconfirmation was not confirmed.');
      return {
        accepted: null,
        grant: { grantId, eventId: event.id, expiresAt: grant.expiresAt as string },
      };
    },
  });
}
export function resolveSos(
  options: RideClientOptions,
  rideId: string,
  sosId: string,
  id: string,
  kind: 'reporter_okay' | 'coordination_closed',
  reason?: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/sos/${sosId}/resolve`,
    method: 'POST',
    idempotencyKey: id,
    body: { id, resolution: kind, ...(kind === 'coordination_closed' ? { reason } : {}) },
    parse: parseSos,
  });
}
export function acknowledgeSos(
  options: RideClientOptions,
  rideId: string,
  sosId: string,
  deviceId: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/sos/${sosId}/receipts`,
    method: 'POST',
    body: { deviceId, receivedAt: new Date().toISOString() },
    parse: parseSos,
  });
}
