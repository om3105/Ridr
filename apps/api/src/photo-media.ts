import sharp from 'sharp';
import { ApiError } from './api-errors.js';

const invalid = () => new ApiError(422, 'INVALID_PHOTO', 'Choose a JPEG, PNG or WebP photo no larger than 10 MB.');

export async function preparePhoto(bytes: Buffer): Promise<Buffer> {
  if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw invalid();
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata();
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
      !metadata.width || !metadata.height ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.width > 12000 || metadata.height > 12000
    ) throw invalid();
    for (const quality of [82, 68, 52]) {
      const clean = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' })
        .rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (clean.length <= 2 * 1024 * 1024) return clean;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
  throw invalid();
}

export function validPhotoPoint(point: unknown): point is { lat: number; lon: number } {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return false;
  const value = point as Record<string, unknown>;
  return Object.keys(value).sort().join(',') === 'lat,lon' &&
    typeof value.lat === 'number' && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 &&
    typeof value.lon === 'number' && Number.isFinite(value.lon) && Math.abs(value.lon) <= 180;
}

export function distanceMetres(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function distanceToRouteMetres(
  point: { lat: number; lon: number },
  route: { lat: number; lon: number }[],
) {
  if (route.length === 0) return Infinity;
  let nearest = distanceMetres(point, route[0]!);
  const longitudeScale = Math.cos(point.lat * Math.PI / 180);
  for (let index = 1; index < route.length; index++) {
    const start = route[index - 1]!;
    const end = route[index]!;
    const x1 = (start.lon - point.lon) * longitudeScale;
    const y1 = start.lat - point.lat;
    const dx = (end.lon - start.lon) * longitudeScale;
    const dy = end.lat - start.lat;
    const portion = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / (dx * dx + dy * dy || 1)));
    const projected = { lat: start.lat + portion * (end.lat - start.lat),
      lon: start.lon + portion * (end.lon - start.lon) };
    nearest = Math.min(nearest, distanceMetres(point, projected));
  }
  return nearest;
}
