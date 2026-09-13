export interface ApiConfig {
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  auth?: AuthConfig;
}

export interface AuthConfig {
  url: string;
  databaseUrl: string;
  jwtSecret?: string;
}

function postgresUrl(value: string | undefined, name: string): string {
  try {
    const parsed = new URL(value ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      !parsed.username ||
      parsed.pathname.length < 2 ||
      parsed.hash
    )
      throw new Error();
    return value!;
  } catch {
    throw new Error(`${name} must be a PostgreSQL URL with a user, host, and database.`);
  }
}

export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const environment = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const portText = env.API_PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer from 1 to 65535.');
  }

  const host = env.API_HOST ?? '127.0.0.1';
  if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host)) {
    throw new Error('API_HOST must be a hostname or IP address.');
  }

  const databaseUrl = postgresUrl(env.DATABASE_URL, 'DATABASE_URL');

  let auth: AuthConfig | undefined;
  if (env.SUPABASE_AUTH_URL || env.AUTH_DATABASE_URL || env.SUPABASE_JWT_SECRET) {
    let url: URL;
    try {
      url = new URL(env.SUPABASE_AUTH_URL ?? '');
      const localHttp =
        environment !== 'production' &&
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (
        (!localHttp && url.protocol !== 'https:') ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        env.SUPABASE_AUTH_URL?.endsWith('/')
      )
        throw new Error();
    } catch {
      throw new Error(
        'SUPABASE_AUTH_URL must be an HTTPS Auth base URL without a trailing slash; HTTP loopback is allowed for local development.',
      );
    }
    const jwtSecret = env.SUPABASE_JWT_SECRET;
    if (jwtSecret && (environment === 'production' || jwtSecret.length < 32)) {
      throw new Error(
        'SUPABASE_JWT_SECRET is for local development only and must have at least 32 characters.',
      );
    }
    auth = {
      url: env.SUPABASE_AUTH_URL!,
      databaseUrl: postgresUrl(env.AUTH_DATABASE_URL, 'AUTH_DATABASE_URL'),
      ...(jwtSecret ? { jwtSecret } : {}),
    };
  }

  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
        throw new Error();
      }
    } catch {
      throw new Error(
        'CORS_ORIGINS must contain exact HTTP(S) origins without paths or wildcards.',
      );
    }
  }

  return {
    environment: environment as ApiConfig['environment'],
    host,
    port,
    databaseUrl,
    corsOrigins: [...new Set(corsOrigins)],
    ...(auth ? { auth } : {}),
  };
}
