export type ConnectionResult =
  | { status: 'ready'; checkedAt: number }
  | { status: 'unavailable' | 'offline' | 'timeout' | 'invalid-response' | 'not-configured' };

export const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

function readinessUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      return null;
    }
    return `${url.origin}/v1/health/ready`;
  } catch {
    return null;
  }
}

function isReady(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const health = value as Record<string, unknown>;
  if (health.status !== 'ok' || health.service !== 'ridr-api') return false;
  if (typeof health.checks !== 'object' || health.checks === null) return false;
  const checks = health.checks as Record<string, unknown>;
  return checks.database === 'up' && checks.schema === 'up' && checks.postgis === 'up';
}

export async function checkConnection(
  baseUrl: string,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<ConnectionResult> {
  const endpoint = readinessUrl(baseUrl);
  if (!endpoint) return { status: 'not-configured' };

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 5000);

  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return { status: 'unavailable' };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: timedOut ? 'timeout' : 'invalid-response' };
    }
    return isReady(body)
      ? { status: 'ready', checkedAt: Date.now() }
      : { status: 'invalid-response' };
  } catch {
    return { status: timedOut ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timeout);
  }
}
