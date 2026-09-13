import 'react-native-url-polyfill/auto';
import { AuthClient, type GoTrueClient } from '@supabase/auth-js';
import { sessionStorage } from './session-storage';

export function authConfiguration(urlValue: string, keyValue: string) {
  try {
    const url = new URL(urlValue);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !keyValue.trim()
    )
      return null;
    const urlString = url.toString().replace(/\/$/, '');
    const scope = Array.from(urlString, (char) =>
      char.charCodeAt(0).toString(16).padStart(4, '0'),
    ).join('');
    return { url: urlString, key: keyValue.trim(), storageKey: `ridr.auth.${scope}` };
  } catch {
    return null;
  }
}

const configuration = authConfiguration(
  process.env.EXPO_PUBLIC_SUPABASE_AUTH_URL ?? '',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

export const authConfigured = configuration !== null;
export const recoveryIntentKey = `${configuration?.storageKey ?? 'ridr.auth'}.recovery`;
export const logoutIntentKey = `${configuration?.storageKey ?? 'ridr.auth'}.logout`;

export function createAuthClient(): GoTrueClient | null {
  if (!configuration) return null;
  return new AuthClient({
    url: configuration.url,
    headers: { apikey: configuration.key },
    storageKey: configuration.storageKey,
    storage: sessionStorage,
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: 'pkce',
    debug: false,
    fetch: async (input, init) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      init?.signal?.addEventListener('abort', abort);
      if (init?.signal?.aborted) abort();
      const timer = setTimeout(abort, 12000);
      try {
        return await fetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timer);
        init?.signal?.removeEventListener('abort', abort);
      }
    },
  });
}
