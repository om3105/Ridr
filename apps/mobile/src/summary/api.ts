import { request, RideError, type RideClientOptions } from '../rides/api';
import type { TrailGeometry } from '../group-map/trails';

export interface RideSummary {
  rideId: string;
  rideName: string;
  memberId: string;
  displayName: string;
  startedAt: string;
  endedAt: string;
  participationStartedAt: string;
  participationEndedAt: string;
  recordedDistanceM: number;
  participationDurationSeconds: number;
  elapsedPaceMinPerKm: number | null;
  averageSpeedKmh: number | null;
  sampleCount: number;
  excludedSamples: number;
  gapCount: number;
  gaps: { from: string; to: string; reason: string }[];
  trace: {
    segments: { lat: number; lon: number }[][];
    shownPoints: number;
    previewComplete: boolean;
  };
  routePoints: { lat: number; lon: number }[];
  memberEvents: {
    memberId: string;
    displayName: string;
    kind: 'left' | 'sharing_stopped';
    at: string;
  }[];
  memberEventsComplete: boolean;
  updatedAt: string;
  expiresAt: string;
}
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nonnegative = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const point = (value: unknown): value is { lat: number; lon: number } => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.lat === 'number' &&
    Math.abs(p.lat) <= 90 &&
    typeof p.lon === 'number' &&
    Math.abs(p.lon) <= 180
  );
};
export function parseRideSummary(value: unknown, rideId: string): RideSummary {
  const row = value as RideSummary | null;
  if (
    !row ||
    typeof row !== 'object' ||
    row.rideId !== rideId ||
    !uuid(row.memberId) ||
    typeof row.rideName !== 'string' ||
    typeof row.displayName !== 'string' ||
    ![
      row.startedAt,
      row.endedAt,
      row.participationStartedAt,
      row.participationEndedAt,
      row.updatedAt,
      row.expiresAt,
    ].every(date) ||
    !nonnegative(row.recordedDistanceM) ||
    !Number.isSafeInteger(row.participationDurationSeconds) ||
    row.participationDurationSeconds < 0 ||
    (row.elapsedPaceMinPerKm !== null && !nonnegative(row.elapsedPaceMinPerKm)) ||
    (row.averageSpeedKmh !== null && !nonnegative(row.averageSpeedKmh)) ||
    !Number.isSafeInteger(row.sampleCount) ||
    row.sampleCount < 0 ||
    !Number.isSafeInteger(row.excludedSamples) ||
    row.excludedSamples < 0 ||
    !Number.isSafeInteger(row.gapCount) ||
    row.gapCount < 0 ||
    !Array.isArray(row.gaps) ||
    row.gaps.length > 100 ||
    row.gaps.some(
      (gap) =>
        !date(gap.from) ||
        !date(gap.to) ||
        ![
          'missing_samples',
          'poor_accuracy',
          'implausible_jump',
          'sharing_change',
          'sharing_off',
        ].includes(gap.reason),
    ) ||
    !row.trace ||
    !Array.isArray(row.trace.segments) ||
    row.trace.segments.some(
      (segment) => !Array.isArray(segment) || segment.length === 0 || segment.some((p) => !point(p)),
    ) ||
    !Number.isSafeInteger(row.trace.shownPoints) ||
    row.trace.shownPoints < 0 ||
    row.trace.shownPoints > 2000 ||
    row.trace.segments.reduce((count, segment) => count + segment.length, 0) !==
      row.trace.shownPoints ||
    typeof row.trace.previewComplete !== 'boolean' ||
    !Array.isArray(row.routePoints) ||
    row.routePoints.length > 10000 ||
    row.routePoints.some((p) => !point(p)) ||
    !Array.isArray(row.memberEvents) ||
    row.memberEvents.length > 200 ||
    typeof row.memberEventsComplete !== 'boolean' ||
    row.memberEvents.some(
      (event) =>
        !uuid(event.memberId) ||
        typeof event.displayName !== 'string' ||
        !['left', 'sharing_stopped'].includes(event.kind) ||
        !date(event.at),
    )
  )
    throw new RideError('invalid', 'The ride summary response is invalid. Refresh it.');
  return row;
}
export function getRideSummary(options: RideClientOptions, rideId: string) {
  return request(options, {
    path: `/v1/history/${encodeURIComponent(rideId)}`,
    parse: (value) => parseRideSummary(value, rideId),
  });
}
export function summaryTraceGeometry(summary: RideSummary): TrailGeometry {
  return {
    type: 'FeatureCollection',
    features: summary.trace.segments.map((segment) =>
      segment.length > 1
        ? {
            type: 'Feature' as const,
            properties: { kind: 'recorded' },
            geometry: {
              type: 'LineString' as const,
              coordinates: segment.map((p) => [p.lon, p.lat]),
            },
          }
        : {
            type: 'Feature' as const,
            properties: { kind: 'observation' },
            geometry: { type: 'Point' as const, coordinates: [segment[0]!.lon, segment[0]!.lat] },
          },
    ),
  };
}
