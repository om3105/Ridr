import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deletePhoto, listPhotos, parsePhoto, uploadPhoto } from '../src/photos/api';
import { RideError } from '../src/rides/api';
import { photoDataUri } from '../src/photos/base64';

const accountId = '9d306983-8713-48e6-80b6-b94156641c46';
const rideId = '90c03156-a273-4985-9edf-14409842c31b';
const photoId = 'bb429cf9-28e7-48ab-bc74-20bd5c5f1fb2';
const photo = { id: photoId, rideId, authorMemberId: accountId, authorName: 'Rider',
  routePoint: { lat: 18.52, lon: 73.85 }, byteLength: 8000,
  createdAt: '2026-09-28T10:00:00.000Z', own: true };
const options = { apiUrl: 'http://127.0.0.1:3000', accessToken: 'access', userId: accountId };

test('photo responses reject cross-ride, oversized, duplicate and malformed entries', async () => {
  assert.throws(() => parsePhoto({ ...photo, rideId: accountId }, rideId));
  assert.throws(() => parsePhoto({ ...photo, byteLength: 3 * 1024 * 1024 }, rideId));
  await assert.rejects(listPhotos({ ...options, fetcher: async () => Response.json({
    data: { items: [photo, photo], nextCursor: null }, requestId: accountId,
  }) }, rideId));
});

test('photo upload keeps stable identity, chosen route point and private authorization', async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, `/v1/history/${rideId}/photos`);
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), photoId);
    assert.ok(init?.body instanceof FormData);
    const form = init.body as FormData;
    assert.equal(form.get('photoId'), photoId);
    assert.equal(form.get('routePoint'), JSON.stringify(photo.routePoint));
    assert.equal((form.get('photo') as File).name, 'photo.jpg');
    return Response.json({ data: photo, requestId: accountId });
  };
  const result = await uploadPhoto({ ...options, fetcher }, rideId, {
    photoId, file: { uri: 'unused', name: file.name, type: 'image/jpeg', file },
    routePoint: photo.routePoint, motion: { capturedAt: '2026-09-28T10:00:00.000Z',
      motion: { state: 'stopped', source: 'speed', observedAt: '2026-09-28T10:00:00.000Z' } },
  });
  assert.equal(result.id, photoId);
  await deletePhoto({ ...options, fetcher: async (_input, init) => {
    assert.equal(init?.method, 'DELETE');
    return new Response(null, { status: 204 });
  } }, rideId, photoId);
});

test('invalid photo and route point receive specific recovery messages', async () => {
  for (const [code, pattern] of [['INVALID_PHOTO', /JPEG/], ['INVALID_PHOTO_POINT', /route/]] as const) {
    await assert.rejects(listPhotos({ ...options, fetcher: async () => Response.json({
      error: { code },
    }, { status: 422 }) }, rideId),
    (error: unknown) => error instanceof RideError && pattern.test(error.message));
  }
});

test('private photo bytes can be rendered in memory without a cached URL', () => {
  assert.equal(photoDataUri(new Uint8Array([0xff, 0xd8, 0xff])), 'data:image/jpeg;base64,/9j/');
  assert.equal(photoDataUri(new Uint8Array([1])), 'data:image/jpeg;base64,AQ==');
});
