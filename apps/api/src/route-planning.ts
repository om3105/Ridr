import { SaxesParser } from 'saxes';
import { ApiError } from './api-errors.js';
import type { MotionContext } from './ride-types.js';

export type Point = { lat: number; lon: number };
export type RouteProfile = 'cycling' | 'driving';
export interface SavedRoute {
  id: string;
  source: 'gpx' | 'drawn';
  profile: RouteProfile;
  points: Point[];
  revision: number;
}
export interface RouteChange extends MotionContext {
  idempotencyKey: string;
  revision: number;
  source: 'gpx' | 'drawn';
  points: Point[];
}
export const invalidRoute = (message: string) => new ApiError(422, 'INVALID_ROUTE', message);
export function validatePoints(value: unknown, max = 10000): Point[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > max)
    throw invalidRoute(`Choose 2–${max} route points.`);
  const points = value.map((p: unknown) => {
    if (
      !p ||
      typeof p !== 'object' ||
      !('lat' in p) ||
      !('lon' in p) ||
      Object.keys(p).some((k) => k !== 'lat' && k !== 'lon') ||
      typeof p.lat !== 'number' ||
      !Number.isFinite(p.lat) ||
      Math.abs(p.lat) > 90 ||
      typeof p.lon !== 'number' ||
      !Number.isFinite(p.lon) ||
      Math.abs(p.lon) > 180
    )
      throw invalidRoute(
        'Every point needs a latitude from −90 to 90 and longitude from −180 to 180.',
      );
    return { lat: p.lat, lon: p.lon };
  });
  if (!points.some((p) => p.lat !== points[0]!.lat || p.lon !== points[0]!.lon))
    throw invalidRoute('The route must contain at least two distinct points.');
  return points;
}
export function parseGpx(buffer: Buffer, name: string): Point[] {
  if (!/\.gpx$/i.test(name))
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Select a .gpx file.');
  if (buffer.length > 5 * 1024 * 1024)
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Select a GPX file no larger than 5 MB.');
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw invalidRoute('Export your GPX file as UTF-8.');
  }
  const points: Point[] = [];
  const stack: string[] = [];
  let containers = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw invalidRoute('GPX files must not contain a DTD or external entities.');
  });
  parser.on('error', () => {
    throw invalidRoute('This GPX is malformed. Export it again.');
  });
  parser.on('opentag', (tag) => {
    const validNamespace = [
      '',
      'http://www.topografix.com/GPX/1/0',
      'http://www.topografix.com/GPX/1/1',
    ].includes(tag.uri);
    const path = [...stack, tag.local].join('/');
    if (!stack.length && (tag.local !== 'gpx' || !validNamespace))
      throw invalidRoute('Select a GPX document.');
    if (stack.length > 64) throw invalidRoute('The GPX nesting is too deep.');
    if (validNamespace && ['gpx/trk/trkseg', 'gpx/rte'].includes(path)) containers++;
    if (validNamespace && ['gpx/trk/trkseg/trkpt', 'gpx/rte/rtept'].includes(path)) {
      const coordinate = (key: string) => {
        const attribute = tag.attributes[key];
        const value = typeof attribute === 'object' ? attribute.value : '';
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))
          throw invalidRoute('A GPX coordinate is invalid.');
        return Number(value);
      };
      points.push({ lat: coordinate('lat'), lon: coordinate('lon') });
      if (points.length > 10000)
        throw invalidRoute('Export a route with no more than 10,000 points.');
    }
    // Foreign extension elements cannot impersonate GPX ancestors.
    stack.push(validNamespace ? tag.local : '#extension');
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(xml).close();
  if (containers !== 1)
    throw invalidRoute(
      'Export one continuous track segment or one route; disconnected segments cannot be joined automatically.',
    );
  return validatePoints(points);
}

export type Router = (points: Point[], profile: RouteProfile) => Promise<Point[]>;
export function osrmRouter(
  endpoints: Partial<Record<RouteProfile, string>>,
  fetcher = fetch,
): Router {
  return async (points, profile) => {
    validatePoints(points, 25);
    const origin = endpoints[profile];
    if (!origin)
      throw new ApiError(
        503,
        'ROUTING_UNAVAILABLE',
        'Road routing is not configured for this transport. Import a GPX or try again after routing is configured.',
      );
    try {
      const base = new URL(origin);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash
      )
        throw new Error();
      const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
      const response = await fetcher(
        `${base.origin}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&radiuses=${points.map(() => '100').join(';')}`,
        { signal: AbortSignal.timeout(8000), redirect: 'error' },
      );
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 2 * 1024 * 1024) throw new Error();
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (data.code !== 'Ok' || data.routes?.[0]?.geometry?.type !== 'LineString')
        throw new Error();
      const coordinates: unknown = data.routes[0].geometry.coordinates;
      if (!Array.isArray(coordinates)) throw new Error();
      return validatePoints(
        coordinates.map((p: unknown) => {
          if (!Array.isArray(p) || p.length !== 2) throw new Error();
          return { lon: p[0], lat: p[1] };
        }),
      );
    } catch {
      throw new ApiError(
        503,
        'ROUTING_UNAVAILABLE',
        'No road route could be confirmed. Check routing coverage or choose different points. Your saved route is unchanged.',
      );
    }
  };
}
