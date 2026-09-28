function publicHttpsOrigin(value: string | undefined, name: string): URL {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(`${name} must be a public HTTPS origin.`);
  }
  const host = url.hostname.toLowerCase();
  const privateIpv4 = /^(?:0|10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))\./.test(host);
  const reservedName = /\.(?:example|invalid|test)$/.test(host);
  if (
    url.protocol !== 'https:' || !host || host === 'localhost' || host === 'localhost.' ||
    host.endsWith('.localhost') || host.endsWith('.localhost.') || host.endsWith('.local') ||
    host.endsWith('.internal') || reservedName || host === '[::1]' || host.startsWith('[fc') ||
    host.startsWith('[fd') || host.startsWith('[fe80') || privateIpv4 ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.port && url.port !== '443')
  ) {
    throw new Error(`${name} must be a public HTTPS origin.`);
  }
  return url;
}

export function assertStandaloneConfiguration(env: Record<string, string | undefined>): void {
  publicHttpsOrigin(env.EXPO_PUBLIC_API_URL, 'EXPO_PUBLIC_API_URL');
  const authUrl = env.EXPO_PUBLIC_SUPABASE_AUTH_URL;
  if (!authUrl?.endsWith('/auth/v1')) {
    throw new Error('EXPO_PUBLIC_SUPABASE_AUTH_URL must be a hosted HTTPS /auth/v1 URL.');
  }
  publicHttpsOrigin(authUrl.slice(0, -'/auth/v1'.length), 'EXPO_PUBLIC_SUPABASE_AUTH_URL');
  if (!env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY is required for a standalone build.');
  }
  if (!env.EXPO_PUBLIC_MAPTILER_KEY?.trim()) {
    throw new Error('EXPO_PUBLIC_MAPTILER_KEY is required for a standalone build.');
  }
}
