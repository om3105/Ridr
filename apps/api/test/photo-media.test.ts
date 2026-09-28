import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { ApiError } from '../src/api-errors.js';
import { distanceToRouteMetres, preparePhoto, validPhotoPoint } from '../src/photo-media.js';

test('photo processing decodes allowed input, bounds output and strips GPS metadata', async () => {
  const source = await sharp({ create: { width: 3000, height: 2200, channels: 3,
    background: { r: 45, g: 88, b: 120 } } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '18/1 31/1 0/1',
      GPSLongitudeRef: 'E', GPSLongitude: '73/1 51/1 0/1' } })
    .toBuffer();
  assert.ok((await sharp(source).metadata()).exif);
  const clean = await preparePhoto(source);
  const metadata = await sharp(clean).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.ok(metadata.width! <= 2048 && metadata.height! <= 2048);
  assert.ok(clean.length <= 2 * 1024 * 1024);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
});

test('photo input rejects disguise, unsupported format, oversize and invalid route points', async () => {
  await assert.rejects(preparePhoto(Buffer.from('not an image')),
    (error: unknown) => error instanceof ApiError && error.code === 'INVALID_PHOTO');
  await assert.rejects(preparePhoto(Buffer.alloc(10 * 1024 * 1024 + 1)),
    (error: unknown) => error instanceof ApiError && error.code === 'INVALID_PHOTO');
  const gif = await sharp({ create: { width: 2, height: 2, channels: 3,
    background: 'red' } }).gif().toBuffer();
  await assert.rejects(preparePhoto(gif),
    (error: unknown) => error instanceof ApiError && error.code === 'INVALID_PHOTO');
  assert.equal(validPhotoPoint({ lat: 18.52, lon: 73.85 }), true);
  assert.equal(validPhotoPoint({ lat: 18.52, lon: 73.85, hidden: true }), false);
  const route = [{ lat: 18.52, lon: 73.85 }, { lat: 18.54, lon: 73.87 }];
  assert.ok(distanceToRouteMetres({ lat: 18.53, lon: 73.86 }, route) < 1);
  assert.ok(distanceToRouteMetres({ lat: 18.53, lon: 73.87 }, route) > 50);
});
