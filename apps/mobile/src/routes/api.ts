import { request, type RideClientOptions } from '../rides/api';
import type { MotionContext } from '../rides/models';
export interface Point {
  lat: number;
  lon: number;
}
export interface SavedRoute {
  id: string;
  points: Point[];
  revision: number;
  source: 'gpx' | 'drawn';
  profile: 'cycling' | 'driving';
}
export function validPoints(value: unknown): value is Point[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 10000 &&
    value.every(
      (p) =>
        p &&
        typeof p.lat === 'number' &&
        Number.isFinite(p.lat) &&
        Math.abs(p.lat) <= 90 &&
        typeof p.lon === 'number' &&
        Number.isFinite(p.lon) &&
        Math.abs(p.lon) <= 180,
    )
  );
}
function parseRoute(value: unknown, id: string): SavedRoute {
  const route = value as SavedRoute | null;
  if (
    !route ||
    route.id !== id ||
    !validPoints(route.points) ||
    !Number.isSafeInteger(route.revision) ||
    route.revision < 1 ||
    !['gpx', 'drawn'].includes(route.source) ||
    !['cycling', 'driving'].includes(route.profile)
  )
    throw new Error('Invalid route response.');
  return route;
}
export function getRoute(options: RideClientOptions, id: string) {
  return request(options, {
    path: `/v1/rides/${encodeURIComponent(id)}/route`,
    parse: (value) => (value === null ? null : parseRoute(value, id)),
  });
}
export interface RouteDraft {
  points: Point[];
  file: { uri: string; name: string; file?: File } | null;
}
export interface SaveCommand {
  draft: RouteDraft;
  revision: number;
  idempotencyKey: string;
  motion: MotionContext;
}
export function saveRoute(options: RideClientOptions, id: string, command: SaveCommand) {
  const file = command.draft.file;
  if (!file && (!validPoints(command.draft.points) || command.draft.points.length > 25))
    throw new Error('Tap 2–25 waypoints on the map.');
  let form: FormData | undefined;
  if (file) {
    form = new FormData();
    // Native FormData reads the selected cache URI; web uses the browser File.
    form.append(
      'file',
      file.file ??
        ({ uri: file.uri, name: file.name, type: 'application/gpx+xml' } as unknown as Blob),
    );
    form.append('motion', JSON.stringify(command.motion.motion));
    form.append('capturedAt', command.motion.capturedAt);
  }
  return request(
    { ...options, timeoutMs: 15000 },
    {
      path: `/v1/rides/${encodeURIComponent(id)}/route${file ? '/import' : ''}`,
      method: file ? 'POST' : 'PUT',
      revision: command.revision,
      idempotencyKey: command.idempotencyKey,
      ...(form ? { form } : { body: { points: command.draft.points, ...command.motion } }),
      parse: (value) => parseRoute(value, id),
    },
  );
}
