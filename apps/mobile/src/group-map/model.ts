import type { LocationSnapshot } from '../location/types';

export function newerSnapshot(current: LocationSnapshot | null, next: LocationSnapshot) {
  return !current ||
    (current.rideId === next.rideId &&
      next.sequence >= current.sequence &&
      Date.parse(next.serverTime) >= Date.parse(current.serverTime))
    ? next
    : current;
}
export function projectGroup(snapshot: LocationSnapshot, now: number) {
  const samples = new Map(snapshot.items.map((item) => [item.memberId, item]));
  const members = snapshot.members.map((member) => {
    const sample = member.sharingEnabled ? samples.get(member.id) : undefined;
    const age = sample ? now - Date.parse(sample.position.recordedAt) : 0;
    const state = !member.sharingEnabled
      ? 'sharing off'
      : !sample
        ? 'waiting for location'
        : age > 30000 || age < -5000 || sample.freshness === 'stale'
          ? 'stale'
          : sample.position.accuracyM > 50 || sample.freshness === 'degraded'
            ? 'low accuracy'
            : 'live';
    return {
      ...member,
      sample,
      state,
      speed: state === 'live' ? (sample?.speedKph ?? null) : null,
      heading: state === 'live' ? (sample?.headingDegrees ?? null) : null,
    };
  });
  const byId = new Map(members.map((member) => [member.id, member]));
  const passengers = new Set(snapshot.pairs.map((pair) => pair.pillionMemberId));
  const pairs = new Map(snapshot.pairs.map((pair) => [pair.riderMemberId, pair]));
  const features = members
    .filter((member) => member.sample && !passengers.has(member.id))
    .map((member) => {
      const pair = pairs.get(member.id);
      const passenger = pair ? byId.get(pair.pillionMemberId) : undefined;
      return {
        type: 'Feature' as const,
        id: member.id,
        properties: {
          label: `${member.displayName}${passenger ? ` + ${passenger.displayName} (pillion)` : ''}${member.state !== 'live' ? ` · ${member.state}` : member.speed !== null ? ` · ${Math.round(member.speed)} km/h` : ''}`,
          color:
            member.state === 'live' ? '#16715b' : member.state === 'stale' ? '#697580' : '#ad6500',
          heading: member.heading,
          state: member.state,
          paired: Boolean(passenger),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [member.sample!.position.lon, member.sample!.position.lat],
        },
      };
    });
  return { members, data: { type: 'FeatureCollection' as const, features } };
}
export type GroupProjection = ReturnType<typeof projectGroup>;
