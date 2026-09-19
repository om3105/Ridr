import { spawnSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Prepare the cropped Pune extract; see docs/day-08 for reproducible download/crop steps.
const root = resolve('data/routing/pune');
const input = resolve(root, 'pune.osm.pbf');
await mkdir(root, { recursive: true });
const image = 'ghcr.io/project-osrm/osrm-backend:v26.9.0-debian';
for (const [mode, profile] of [
  ['driving', 'car'],
  ['cycling', 'bicycle'],
]) {
  const directory = resolve(root, mode);
  await mkdir(directory, { recursive: true });
  await copyFile(input, resolve(directory, 'pune.osm.pbf'));
  for (const args of [
    ['osrm-extract', '--threads', '2', '-p', `/opt/${profile}.lua`, '/data/pune.osm.pbf'],
    ['osrm-partition', '--threads', '2', '/data/pune.osrm'],
    ['osrm-customize', '--threads', '2', '/data/pune.osrm'],
  ]) {
    const result = spawnSync(
      'docker',
      ['run', '--rm', '-v', `${directory}:/data`, image, ...args],
      { stdio: 'inherit' },
    );
    if (result.error || result.status !== 0)
      throw new Error(`Pune ${mode} preparation failed at ${args[0]}.`);
  }
}
console.log('Prepared Pune driving and cycling data. Start with compose.pune.yaml override.');
