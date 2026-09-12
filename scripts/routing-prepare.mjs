import { spawnSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Keep this image in sync with compose.yaml; separate preprocessing determines routing mode.
const image = 'ghcr.io/project-osrm/osrm-backend:v26.9.0-debian';
for (const [mode, profile] of [
  ['driving', 'car'],
  ['cycling', 'bicycle'],
]) {
  const directory = resolve('data', 'routing', mode);
  await mkdir(directory, { recursive: true });
  await copyFile('routing/fixtures/test-network.osm', resolve(directory, 'test-network.osm'));
  for (const args of [
    ['osrm-extract', '-p', `/opt/${profile}.lua`, '/data/test-network.osm'],
    ['osrm-partition', '/data/test-network.osrm'],
    ['osrm-customize', '/data/test-network.osrm'],
  ]) {
    const result = spawnSync(
      'docker',
      ['run', '--rm', '-v', `${directory}:/data`, image, ...args],
      { stdio: 'inherit' },
    );
    if (result.error || result.status !== 0) {
      throw new Error(`Routing preparation failed for ${mode}: ${args[0]}`);
    }
  }
}
console.log('Prepared separate synthetic driving and cycling datasets.');
