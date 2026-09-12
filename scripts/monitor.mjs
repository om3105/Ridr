const base = new URL(process.env.MONITOR_API_URL ?? 'http://127.0.0.1:3000');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
  throw new Error('MONITOR_API_URL must be an HTTP(S) origin without credentials');
}
const started = performance.now();
try {
  const response = await fetch(new URL('/v1/health/ready', base), {
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  const healthy =
    response.ok &&
    body.status === 'ok' &&
    body.service === 'ridr-api' &&
    ['database', 'schema', 'postgis'].every((key) => body.checks?.[key] === 'up');
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'ridr-api',
      status: healthy ? 'healthy' : 'unavailable',
      durationMs: Math.round(performance.now() - started),
    }),
  );
  process.exitCode = healthy ? 0 : 1;
} catch {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'ridr-api',
      status: 'unreachable',
    }),
  );
  process.exitCode = 1;
}
