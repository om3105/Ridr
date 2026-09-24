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
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export function parseSnapshot(value: unknown, expectedRideId?: string): LocationSnapshot {
  const data = object(value);
  if (
    !uuid(data.rideId) ||
    (expectedRideId !== undefined && data.rideId !== expectedRideId) ||
    !uuid(data.ownMemberId) ||
    typeof data.serverTime !== 'string' ||
    !Number.isFinite(Date.parse(data.serverTime)) ||
    !Number.isSafeInteger(data.sequence) ||
    Number(data.sequence) < 0 ||
    !Array.isArray(data.items) ||
    data.items.length > 50 ||
    !Array.isArray(data.members) ||
    data.members.length < 1 ||
    data.members.length > 50 ||
    !Array.isArray(data.pairs) ||
    data.pairs.length > 25
  )
    bad();
  const members = new Map<string, Record<string, unknown>>();
  for (const value of data.members) {
    const member = object(value);
    if (
      !uuid(member.id) ||
      members.has(member.id) ||
      typeof member.displayName !== 'string' ||
      !member.displayName.trim() ||
      member.displayName.length > 80 ||
      !['leader', 'rider', 'pillion'].includes(String(member.role)) ||
      typeof member.sharingEnabled !== 'boolean'
    )
      bad();
    members.set(member.id, member);
  }
  if (!members.has(data.ownMemberId)) bad();
  const paired = new Set<string>(),
    pairIds = new Set<string>();
  for (const value of data.pairs) {
    const pair = object(value);
    if (
      !uuid(pair.id) ||
      pairIds.has(pair.id) ||
      !uuid(pair.riderMemberId) ||
      !uuid(pair.pillionMemberId) ||
      pair.riderMemberId === pair.pillionMemberId ||
      paired.has(pair.riderMemberId) ||
      paired.has(pair.pillionMemberId) ||
      !['leader', 'rider'].includes(String(members.get(pair.riderMemberId)?.role)) ||
      members.get(pair.pillionMemberId)?.role !== 'pillion'
    )
      bad();
    paired.add(pair.riderMemberId);
    paired.add(pair.pillionMemberId);
    pairIds.add(pair.id);
  }
  const reporting = new Set<string>();
  const items = data.items.map((value) => {
    const row = object(value),
      p = object(row.position);
    if (
      !uuid(row.memberId) ||
      reporting.has(row.memberId) ||
      !members.get(row.memberId)?.sharingEnabled ||
      !uuid(row.sampleId) ||
      !['fresh', 'degraded', 'stale'].includes(String(row.freshness)) ||
      !finite(p.lat, -90, 90) ||
      !finite(p.lon, -180, 180) ||
      !finite(p.accuracyM, 0, 100000) ||
      typeof p.recordedAt !== 'string' ||
      !Number.isFinite(Date.parse(p.recordedAt))
    )
      bad();
    reporting.add(row.memberId);
    return {
      ...row,
      position: { lat: p.lat, lon: p.lon, accuracyM: p.accuracyM, recordedAt: p.recordedAt },
      speedKph: finite(row.speedKph, 0, 500) ? row.speedKph : null,
      headingDegrees:
        finite(row.headingDegrees, 0, 360) && row.headingDegrees < 360 ? row.headingDegrees : null,
    };
  });
  if (data.alertSettings !== undefined) {
    const settings = object(data.alertSettings);
    if (
      !Number.isInteger(settings.stragglerDistanceM) ||
      !finite(settings.stragglerDistanceM, 200, 2000) ||
      ![10, 20, 30].includes(Number(settings.batteryThreshold))
    )
      bad();
  }
  if (data.alerts !== undefined) {
    if (!Array.isArray(data.alerts) || data.alerts.length > 100) bad();
    const ids = new Set<string>();
    for (const value of data.alerts) {
      const warning = object(value),
        position = object(warning.position);
      if (
        !uuid(warning.id) ||
        ids.has(warning.id) ||
        !uuid(warning.memberId) ||
        !reporting.has(warning.memberId) ||
        !['battery', 'straggler'].includes(String(warning.kind)) ||
        !finite(warning.value, 0, 40075000) ||
        (warning.kind === 'battery' && !finite(warning.value, 0, 100)) ||
        typeof warning.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(warning.createdAt)) ||
        !finite(position.lat, -90, 90) ||
        !finite(position.lon, -180, 180) ||
        typeof position.recordedAt !== 'string' ||
        !Number.isFinite(Date.parse(position.recordedAt))
      )
        bad();
      ids.add(warning.id);
    }
  }
  return { ...data, items } as unknown as LocationSnapshot;
}
export function getLocations(options: RideClientOptions, rideId: string) {
  return request(options, {
    path: `/v1/rides/${rideId}/locations`,
    parse: (value) => parseSnapshot(value, rideId),
  });
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
