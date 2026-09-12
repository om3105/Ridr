export interface ApiConfig {
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
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

  const databaseUrl = env.DATABASE_URL;
  try {
    const parsed = new URL(databaseUrl ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      !parsed.username ||
      parsed.pathname.length < 2 ||
      parsed.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with a user, host, and database.');
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
    databaseUrl: databaseUrl!,
    corsOrigins: [...new Set(corsOrigins)],
  };
}
