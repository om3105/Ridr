// Pure geometry shared by the server and mobile map. No platform dependencies.
export interface Point {
  lat: number;
  lon: number;
}
export interface LocationSnapshot {
  members: { id: string; sharingEnabled: boolean }[];
  pairs: { riderMemberId: string; pillionMemberId: string }[];
  items: {
    memberId: string;
    sampleId: string;
    position: Point & { accuracyM: number; recordedAt: string };
    freshness: 'fresh' | 'degraded' | 'stale';
  }[];
}
const R = 6371008.8,
  rad = Math.PI / 180;
const longitude = (value: number) => ((value + 540) % 360) - 180;
export function distance(a: Point, b: Point) {
  const dlat = (b.lat - a.lat) * rad,
    dlon = longitude(b.lon - a.lon) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function geographicCentre(points: Point[]): Point | null {
  if (!points.length) return null;
  let x = 0,
    y = 0,
    z = 0;
  for (const p of points) {
    x += Math.cos(p.lat * rad) * Math.cos(p.lon * rad);
    y += Math.cos(p.lat * rad) * Math.sin(p.lon * rad);
    z += Math.sin(p.lat * rad);
  }
  if (Math.hypot(x, y, z) < 1e-8) return null;
  return { lat: Math.atan2(z, Math.hypot(x, y)) / rad, lon: Math.atan2(y, x) / rad };
}
export interface Progress {
  at: number;
  progress: number;
  sampleId: string;
}
export class RouteProgress {
  private previous = new Map<string, Progress>();
  readonly length: number;
  readonly loop: boolean;
  private segments: {
    a: Point;
    dx: number;
    dy: number;
    scale: number;
    length: number;
    offset: number;
  }[] = [];
  constructor(
    private points: Point[],
    private startedAt: number,
  ) {
    let offset = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!,
        length = distance(a, b);
      const scale = Math.cos(((a.lat + b.lat) / 2) * rad);
      if (length > 0.01)
        this.segments.push({
          a,
          dx: longitude(b.lon - a.lon) * rad * R * scale,
          dy: (b.lat - a.lat) * rad * R,
          scale,
          length,
          offset,
        });
      offset += length;
    }
    this.length = offset;
    this.loop = points.length > 2 && offset > 100 && distance(points[0]!, points.at(-1)!) <= 20;
  }
  restore(entries: [string, Progress][]) {
    this.previous = new Map(entries);
  }
  exportState(): [string, Progress][] {
    return [...this.previous.entries()];
  }
  clear(memberId: string) {
    this.previous.delete(memberId);
  }
  update(memberId: string, sample: LocationSnapshot['items'][number]): number | null {
    const at = Date.parse(sample.position.recordedAt),
      old = this.previous.get(memberId);
    if (old && old.sampleId === sample.sampleId) return old.progress;
    if (old && at <= old.at) return null;
    const prior = old && at - old.at <= 30000 ? old : undefined;
    const maxMove = prior
      ? ((at - prior.at) / 1000) * 60 + 2 * sample.position.accuracyM
      : Infinity;
    if (this.loop && prior && maxMove >= this.length / 2) {
      this.clear(memberId);
      return null;
    }
    const candidates: { progress: number; error: number }[] = [];
    for (const segment of this.segments) {
      const x = longitude(sample.position.lon - segment.a.lon) * rad * R * segment.scale;
      const y = (sample.position.lat - segment.a.lat) * rad * R;
      const t = Math.max(
        0,
        Math.min(1, (x * segment.dx + y * segment.dy) / (segment.dx ** 2 + segment.dy ** 2)),
      );
      const error = Math.hypot(x - t * segment.dx, y - t * segment.dy);
      if (error > 50) continue;
      let progress = segment.offset + t * segment.length;
      if (this.loop && prior)
        progress += Math.round((prior.progress - progress) / this.length) * this.length;
      if (prior && Math.abs(progress - prior.progress) > maxMove) continue;
      candidates.push({ progress, error });
    }
    candidates.sort((a, b) => a.error - b.error);
    const best = candidates[0];
    const ambiguous =
      best &&
      candidates.some(
        (candidate) =>
          candidate.error <= best.error + Math.max(5, sample.position.accuracyM) &&
          Math.abs(candidate.progress - best.progress) >
            Math.max(100, 2 * sample.position.accuracyM) &&
          !(
            this.loop &&
            !prior &&
            Math.abs(Math.abs(candidate.progress - best.progress) - this.length) < 100
          ),
      );
    const anchored =
      !this.loop ||
      !!prior ||
      (at >= this.startedAt &&
        at - this.startedAt <= 30000 &&
        distance(sample.position, this.points[0]!) <= 50);
    if (!best || ambiguous || !anchored) {
      this.clear(memberId);
      return null;
    }
    // Near the loop origin, the end segment and start segment represent the same initial lap.
    const progress =
      this.loop && !prior && best.progress > this.length - 50
        ? best.progress - this.length
        : best.progress;
    this.previous.set(memberId, { at, progress, sampleId: sample.sampleId });
    return progress;
  }
}
export interface GapDetail {
  memberId: string;
  routeGapM: number | null;
  centreDistanceM: number | null;
}
export function groupGaps(snapshot: LocationSnapshot, now: number, route: RouteProgress | null) {
  const samples = new Map(snapshot.items.map((item) => [item.memberId, item]));
  const projected = {
    members: snapshot.members.map((member) => {
      const sample = member.sharingEnabled ? samples.get(member.id) : undefined;
      const age = sample ? now - Date.parse(sample.position.recordedAt) : Infinity;
      return {
        ...member,
        sample,
        state:
          sample &&
          sample.freshness === 'fresh' &&
          sample.position.accuracyM <= 50 &&
          age >= -5000 &&
          age <= 30000
            ? 'live'
            : 'unavailable',
      };
    }),
  };
  const passengers = new Map(
    snapshot.pairs.map((pair) => [pair.pillionMemberId, pair.riderMemberId]),
  );
  const units = projected.members.filter((member) => !passengers.has(member.id));
  const fresh = units.filter((member) => member.state === 'live' && member.sample);
  const freshIds = new Set(fresh.map((member) => member.id));
  for (const member of snapshot.members) if (!freshIds.has(member.id)) route?.clear(member.id);
  const centre =
    fresh.length >= 2 ? geographicCentre(fresh.map((member) => member.sample!.position)) : null;
  const progress = new Map(
    fresh.map((member) => [member.id, route?.update(member.id, member.sample!) ?? null]),
  );
  const values = [...progress.values()]
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const median =
    values.length >= 2
      ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2
      : null;
  const details: GapDetail[] = projected.members.map((member) => {
    const unitId = passengers.get(member.id) ?? member.id;
    const unit = fresh.find((item) => item.id === unitId),
      value = progress.get(unitId);
    return {
      memberId: member.id,
      routeGapM: value != null && median !== null ? value - median : null,
      centreDistanceM: centre && unit ? distance(unit.sample!.position, centre) : null,
    };
  });
  return {
    details,
    freshUnits: fresh.length,
    excludedUnits: units.length - fresh.length,
    matchedUnits: values.length,
    totalUnits: units.length,
  };
}
