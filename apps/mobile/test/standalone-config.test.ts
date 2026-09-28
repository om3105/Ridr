import assert from 'node:assert/strict';
import test from 'node:test';
import { assertStandaloneConfiguration } from '../standalone-config';

const valid = {
  EXPO_PUBLIC_API_URL: 'https://api.ridr.app',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://project.supabase.co/auth/v1',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_example',
  EXPO_PUBLIC_MAPTILER_KEY: 'public-map-key',
};

test('standalone build accepts hosted HTTPS endpoints', () => {
  assert.doesNotThrow(() => assertStandaloneConfiguration(valid));
});

test('standalone build rejects missing or laptop-only configuration', () => {
  for (const apiUrl of [undefined, 'http://localhost:3000', 'http://192.168.1.3:3000', 'https://10.0.0.3', 'https://localhost.', 'https://dev.localhost', 'https://api.local', 'https://api.ridr.example', 'https://api.ridr.app/path']) {
    assert.throws(() => assertStandaloneConfiguration({ ...valid, EXPO_PUBLIC_API_URL: apiUrl }), /EXPO_PUBLIC_API_URL/);
  }
  assert.throws(() => assertStandaloneConfiguration({ ...valid, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:9999/auth/v1' }), /SUPABASE_AUTH_URL/);
  assert.throws(() => assertStandaloneConfiguration({ ...valid, EXPO_PUBLIC_SUPABASE_ANON_KEY: '' }), /SUPABASE_ANON_KEY/);
  assert.throws(() => assertStandaloneConfiguration({ ...valid, EXPO_PUBLIC_MAPTILER_KEY: '' }), /MAPTILER_KEY/);
});
