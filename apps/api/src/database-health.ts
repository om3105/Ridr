import { Pool } from 'pg';
import { OperationalLogger } from './logging.js';

export const REQUIRED_MIGRATION = '001_initial';
export type CheckStatus = 'up' | 'down' | 'unknown';
export interface Readiness {
  status: 'ok' | 'unavailable';
  service: 'ridr-api';
  checks: { database: CheckStatus; schema: CheckStatus; postgis: CheckStatus };
}

export interface DatabaseHealth {
  check(): Promise<Readiness>;
  close(): Promise<void>;
}

export class PostgresHealth implements DatabaseHealth {
  private readonly pool: Pool;

  constructor(
    databaseUrl: string,
    private readonly logger: OperationalLogger,
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      application_name: 'ridr-api',
      max: 5,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 2000,
      query_timeout: 2500,
    });
    this.pool.on('error', () => this.logger.write('database_pool_error'));
  }

  async check(): Promise<Readiness> {
    const checks: Readiness['checks'] = {
      database: 'down',
      schema: 'unknown',
      postgis: 'unknown',
    };

    try {
      const client = await this.pool.connect();
      try {
        const extension = await client.query<{ installed: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'postgis') AS installed",
        );
        checks.database = 'up';
        checks.postgis = extension.rows[0]?.installed === true ? 'up' : 'down';

        try {
          const migration = await client.query<{ installed: boolean }>(
            'SELECT EXISTS (SELECT 1 FROM ridr.schema_migrations WHERE version = $1) AS installed',
            [REQUIRED_MIGRATION],
          );
          checks.schema = migration.rows[0]?.installed === true ? 'up' : 'down';
        } catch {
          checks.schema = 'down';
        }
      } finally {
        client.release();
      }
    } catch {
      this.logger.write('database_readiness_failed');
    }

    return {
      status: Object.values(checks).every((check) => check === 'up') ? 'ok' : 'unavailable',
      service: 'ridr-api',
      checks,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
