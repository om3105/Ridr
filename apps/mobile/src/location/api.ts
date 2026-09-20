import { request, RideError, type RideClientOptions } from '../rides/api';
import type { Sharing, Sample, LocationSnapshot } from './types';
function bad(): never {
  throw new RideError('invalid', 'The location service returned an unexpected response.');
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : bad();
export function parseSharing(value: unknown): Sharing {
  const data = object(value);
  if (
    typeof data.enabled !== 'boolean' ||
    !Number.isSafeInteger(data.consentEpoch) ||
    Number(data.consentEpoch) < 0 ||
    !Number.isSafeInteger(data.revision) ||
    Number(data.revision) < 1 ||
    typeof data.effectiveAt !== 'string' ||
    !Number.isFinite(Date.parse(data.effectiveAt))
  )
    bad();
  return data as unknown as Sharing;
}
export function enableSharing(
  options: RideClientOptions,
  change: { rideId: string; revision: number; idempotencyKey: string },
) {
  return request(options, {
    path: `/v1/rides/${change.rideId}/sharing`,
    method: 'PUT',
    body: { enabled: true },
    revision: change.revision,
    idempotencyKey: change.idempotencyKey,
    parse: parseSharing,
  });
}
export function registerDevice(
  options: RideClientOptions,
  deviceId: string,
  platform: 'ios' | 'android',
) {
  return request(options, {
    path: `/v1/me/devices/${deviceId}`,
    method: 'PUT',
    body: { platform },
    noContent: true,
    parse: () => undefined,
  });
}
export function sendSample(options: RideClientOptions, deviceId: string, sample: Sample) {
  return request(options, {
    path: `/v1/rides/${sample.rideId}/events`,
    method: 'POST',
    deviceId,
    body: { event: sample },
    parse: (value) => {
      const data = object(value);
      if (
        data.eventId !== sample.id ||
        data.rideId !== sample.rideId ||
        data.type !== 'server.ack' ||
        !['accepted', 'duplicate'].includes(String(data.status)) ||
        !Number.isSafeInteger(data.sequence)
      )
        bad();
      return sample.id;
    },
  });
}
export function sendHistory(options: RideClientOptions, deviceId: string, samples: Sample[]) {
  return request(options, {
    path: `/v1/history/${samples[0]!.rideId}/samples`,
    method: 'POST',
    deviceId,
    body: { samples },
    parse: (value) => {
      const data = object(value),
        ids = new Set(samples.map((s) => s.id));
      if (
        !Array.isArray(data.acceptedIds) ||
        !Array.isArray(data.duplicateIds) ||
        !Array.isArray(data.rejected)
      )
        bad();
      const accepted = [...data.acceptedIds, ...data.duplicateIds];
      if (!accepted.every((id) => typeof id === 'string' && ids.has(id))) bad();
      const rejected = data.rejected.map((item) => {
        const row = object(item);
        if (typeof row.id !== 'string' || !ids.has(row.id) || typeof row.code !== 'string') bad();
        return { id: row.id, code: row.code };
      });
      const all = [...accepted, ...rejected.map((r) => r.id)];
      if (new Set(all).size !== samples.length || all.length !== samples.length) bad();
      return { accepted: accepted as string[], rejected };
    },
  });
}
export function parseSnapshot(value: unknown): LocationSnapshot {
  const data = object(value);
  if (
    typeof data.serverTime !== 'string' ||
    !Number.isFinite(Date.parse(data.serverTime)) ||
    !Number.isSafeInteger(data.sequence) ||
    !Array.isArray(data.items) ||
    data.items.length > 50
  )
    bad();
  for (const item of data.items) {
    const row = object(item),
      p = object(row.position);
    if (
      typeof row.memberId !== 'string' ||
      typeof row.sampleId !== 'string' ||
      !['fresh', 'degraded', 'stale'].includes(String(row.freshness)) ||
      typeof p.lat !== 'number' ||
      !Number.isFinite(p.lat) ||
      Math.abs(p.lat) > 90 ||
      typeof p.lon !== 'number' ||
      !Number.isFinite(p.lon) ||
      Math.abs(p.lon) > 180 ||
      typeof p.accuracyM !== 'number' ||
      !Number.isFinite(p.accuracyM) ||
      p.accuracyM < 0 ||
      typeof p.recordedAt !== 'string' ||
      !Number.isFinite(Date.parse(p.recordedAt))
    )
      bad();
  }
  return data as unknown as LocationSnapshot;
}
export function getLocations(options: RideClientOptions, rideId: string) {
  return request(options, { path: `/v1/rides/${rideId}/locations`, parse: parseSnapshot });
}

export function getSharingStatus(options: RideClientOptions, rideId: string) {
  return request(options, {
    path: `/v1/rides/${rideId}/location-status`,
    parse: (value) => {
      const data = object(value);
      if (
        typeof data.active !== 'boolean' ||
        typeof data.sharing !== 'boolean' ||
        !Number.isSafeInteger(data.epoch) ||
        Number(data.epoch) < 0
      )
        bad();
      return { active: data.active, sharing: data.sharing, epoch: Number(data.epoch) };
    },
  });
}
