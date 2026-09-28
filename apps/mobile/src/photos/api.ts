import { request, RideError, type RideClientOptions } from '../rides/api';
import type { MotionContext } from '../rides/models';

export interface RidePhoto {
  id: string;
  rideId: string;
  authorMemberId: string;
  authorName: string;
  routePoint: { lat: number; lon: number };
  byteLength: number;
  createdAt: string;
  own: boolean;
}
export interface PhotoFile { uri: string; name: string; type: 'image/jpeg' | 'image/png' | 'image/webp'; file?: File }
const uuid = (value: unknown) => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const point = (value: unknown): value is { lat: number; lon: number } => !!value &&
  typeof value === 'object' &&
  Number.isFinite((value as { lat: number }).lat) &&
  Math.abs((value as { lat: number }).lat) <= 90 &&
  Number.isFinite((value as { lon: number }).lon) &&
  Math.abs((value as { lon: number }).lon) <= 180;

export function parsePhoto(value: unknown, rideId: string): RidePhoto {
  const photo = value as RidePhoto | null;
  if (!photo || !uuid(photo.id) || photo.rideId !== rideId || !uuid(photo.authorMemberId) ||
      typeof photo.authorName !== 'string' || !point(photo.routePoint) ||
      !Number.isSafeInteger(photo.byteLength) || photo.byteLength < 1 || photo.byteLength > 2 * 1024 * 1024 ||
      typeof photo.createdAt !== 'string' || !Number.isFinite(Date.parse(photo.createdAt)) ||
      typeof photo.own !== 'boolean')
    throw new RideError('invalid', 'The ride photo response is invalid. Refresh it.');
  return photo;
}
export function listPhotos(options: RideClientOptions, rideId: string, cursor?: string) {
  return request(options, { path: `/v1/history/${rideId}/photos?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, parse: (value) => {
    const page = value as { items: unknown[]; nextCursor: string | null } | null;
    if (!page || !Array.isArray(page.items) || page.items.length > 20 ||
        (page.nextCursor !== null &&
          (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor.length > 1024)))
      throw new RideError('invalid', 'The ride photo list is invalid. Refresh it.');
    const items = page.items.map((item) => parsePhoto(item, rideId));
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new RideError('invalid', 'The ride photo list is invalid. Refresh it.');
    return { items, nextCursor: page.nextCursor };
  } });
}
export function uploadPhoto(options: RideClientOptions, rideId: string, upload: {
  photoId: string; file: PhotoFile; routePoint: { lat: number; lon: number }; motion: MotionContext;
}) {
  if (!point(upload.routePoint) || !uuid(upload.photoId))
    throw new RideError('invalid', 'Choose a point on the ride route.');
  const form = new FormData();
  form.append('photoId', upload.photoId);
  form.append('routePoint', JSON.stringify(upload.routePoint));
  form.append('capturedAt', upload.motion.capturedAt);
  form.append('motion', JSON.stringify(upload.motion.motion));
  form.append('photo', upload.file.file ?? ({ uri: upload.file.uri, name: upload.file.name,
    type: upload.file.type } as unknown as Blob));
  return request({ ...options, timeoutMs: 60000 }, {
    path: `/v1/history/${rideId}/photos`, method: 'POST', form,
    idempotencyKey: upload.photoId, parse: (value) => parsePhoto(value, rideId),
  });
}
export function deletePhoto(options: RideClientOptions, rideId: string, photoId: string) {
  return request(options, { path: `/v1/history/${rideId}/photos/${photoId}`, method: 'DELETE',
    noContent: true, parse: () => undefined });
}
export const photoContentUrl = (apiUrl: string, rideId: string, photoId: string) =>
  `${apiUrl.replace(/\/$/, '')}/v1/history/${rideId}/photos/${photoId}/content`;
