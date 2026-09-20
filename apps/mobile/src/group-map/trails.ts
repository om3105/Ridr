import { request, type RideClientOptions } from '../rides/api';
import { distance } from './geometry';
export interface TrailPoint {
  id: string;
  capturedAt: string;
  lat: number;
  lon: number;
  accuracyM: number;
  consentEpoch: number;
}
export interface TrailPage {
  rideId: string;
  memberId: string;
  points: TrailPoint[];
  nextCursor: string | null;
}
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function parseTrail(value: unknown, rideId: string, memberId: string): TrailPage {
  const page = value as TrailPage | null;
  if (
    !page ||
    page.rideId !== rideId ||
    page.memberId !== memberId ||
    !Array.isArray(page.points) ||
    page.points.length > 200 ||
    !(
      page.nextCursor === null ||
      (typeof page.nextCursor === 'string' && page.nextCursor.length <= 1024)
    )
  )
    throw new Error('Invalid trail response.');
  const ids = new Set<string>();
  for (const p of page.points) {
    if (
      !p ||
      !uuid(p.id) ||
      ids.has(p.id) ||
      typeof p.capturedAt !== 'string' ||
      !Number.isFinite(Date.parse(p.capturedAt)) ||
      !Number.isFinite(p.lat) ||
      Math.abs(p.lat) > 90 ||
      !Number.isFinite(p.lon) ||
      Math.abs(p.lon) > 180 ||
      !Number.isFinite(p.accuracyM) ||
      p.accuracyM < 0 ||
      !Number.isSafeInteger(p.consentEpoch) ||
      p.consentEpoch < 0
    )
      throw new Error('Invalid trail response.');
    ids.add(p.id);
  }
  return page;
}
export function getTrail(
  options: RideClientOptions,
  rideId: string,
  memberId: string,
  cursor?: string,
) {
  return request(options, {
    path: `/v1/rides/${encodeURIComponent(rideId)}/members/${encodeURIComponent(memberId)}/trail${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    parse: (value) => parseTrail(value, rideId, memberId),
  });
}
export function trailGeometry(points: TrailPoint[]) {
  const sorted = [...new Map(points.map((point) => [point.id, point])).values()].sort(
    (a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.id.localeCompare(b.id),
  );
  const isolated: number[][] = [];
  const segments: number[][][] = [],
    breaks: TrailPoint[] = [];
  let previous: TrailPoint | undefined,
    segment: number[][] = [];
  const finish = () => {
    if (segment.length >= 2) segments.push(segment);
    else if (segment.length === 1) isolated.push(segment[0]!);
    segment = [];
  };
  for (const point of sorted) {
    if (point.accuracyM > 50) {
      finish();
      previous = undefined;
      breaks.push(point);
      continue;
    }
    const dt = previous
      ? (Date.parse(point.capturedAt) - Date.parse(previous.capturedAt)) / 1000
      : 0;
    if (
      previous &&
      (dt <= 0 ||
        dt > 30 ||
        point.consentEpoch !== previous.consentEpoch ||
        distance(previous, point) > dt * 60 + previous.accuracyM + point.accuracyM)
    ) {
      finish();
      breaks.push(point);
    }
    segment.push([point.lon, point.lat]);
    previous = point;
  }
  finish();
  return {
    count: sorted.length,
    breaks: breaks.length,
    data: {
      type: 'FeatureCollection' as const,
      features: [
        ...segments.map((coordinates) => ({
          type: 'Feature' as const,
          properties: { kind: 'recorded' },
          geometry: { type: 'LineString' as const, coordinates },
        })),
        ...isolated.map((coordinates) => ({
          type: 'Feature' as const,
          properties: { kind: 'observation' },
          geometry: { type: 'Point' as const, coordinates },
        })),
        ...breaks.map((point) => ({
          type: 'Feature' as const,
          properties: { kind: 'gap' },
          geometry: { type: 'Point' as const, coordinates: [point.lon, point.lat] },
        })),
      ],
    },
  };
}
export type TrailGeometry = ReturnType<typeof trailGeometry>['data'];
