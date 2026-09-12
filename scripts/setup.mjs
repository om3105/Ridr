import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Exclusive creation preserves a developer's existing environment.
const admin = randomBytes(24).toString('hex');
const migrator = randomBytes(24).toString('hex');
const api = randomBytes(24).toString('hex');
const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
try {
  await writeFile(
    new URL('../.env', import.meta.url),
    example
      .replaceAll('replace-with-local-admin-password', admin)
      .replaceAll('replace-with-local-migrator-password', migrator)
      .replaceAll('replace-with-local-api-password', api),
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Created local .env with unique database credentials.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Preserved existing .env.');
}

try {
  await writeFile(
    new URL('../apps/mobile/.env', import.meta.url),
    'EXPO_PUBLIC_API_URL=http://127.0.0.1:3000\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Created mobile .env for this computer. See device setup for phone/emulator URLs.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Preserved existing mobile .env.');
}
