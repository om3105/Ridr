import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const migrationsDirectory = new URL('../database/migrations/', import.meta.url);
const lockKey = [1802072690, 1];

export async function readMigrations(directory = migrationsDirectory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  if (names.length === 0) throw new Error('No SQL migrations found.');
  const versions = new Set();
  return Promise.all(
    names.map(async (name) => {
      const match = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(name);
      if (!match || versions.has(match[1]))
        throw new Error(`Invalid or duplicate migration: ${name}`);
      versions.add(match[1]);
      const sql = await readFile(new URL(name, directory), 'utf8');
      return {
        version: name.slice(0, -4),
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

export async function applyMigrations(client, migrations) {
  await client.query(
    "SET search_path = pg_catalog; SET lock_timeout = '10s'; SET statement_timeout = '60s'",
  );
  const {
    rows: [identity],
  } = await client.query(`
    SELECT current_user AS actor, pg_get_userbyid(nspowner) AS owner
    FROM pg_namespace WHERE nspname = 'ridr'
  `);
  if (identity?.actor !== 'ridr_migrator' || identity.owner !== 'ridr_migrator') {
    throw new Error(
      'Migrations require ridr_migrator and its private ridr schema. Run fresh database initialization first.',
    );
  }
  await client.query('SELECT pg_advisory_lock($1, $2)', lockKey);
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS ridr.schema_migrations (
        version text PRIMARY KEY CHECK (version ~ '^[0-9]{3}_[a-z0-9_]+$'),
        checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      REVOKE ALL ON ridr.schema_migrations FROM PUBLIC, anon, authenticated, ridr_api;
      GRANT SELECT ON ridr.schema_migrations TO ridr_api;
    `);
    await client.query('COMMIT');
    transactionOpen = false;

    const { rows: applied } = await client.query(
      'SELECT version, checksum FROM ridr.schema_migrations ORDER BY version',
    );
    for (const record of applied) {
      const source = migrations.find((migration) => migration.version === record.version);
      if (!source)
        throw new Error(`Applied migration ${record.version} is missing from this checkout.`);
      if (source.checksum !== record.checksum)
        throw new Error(
          `Applied migration ${record.version} was changed. Add a new migration instead.`,
        );
    }
    const completed = new Set(applied.map((record) => record.version));
    const latest = applied.at(-1)?.version;
    const pending = migrations.filter((migration) => !completed.has(migration.version));
    if (pending.some((migration) => latest && migration.version < latest)) {
      throw new Error(
        'A pending migration precedes an already applied version. Add a later version.',
      );
    }

    for (const migration of pending) {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query(migration.sql);
      await client.query('INSERT INTO ridr.schema_migrations (version, checksum) VALUES ($1, $2)', [
        migration.version,
        migration.checksum,
      ]);
      await client.query('COMMIT');
      transactionOpen = false;
    }
    return { applied: pending.map((migration) => migration.version), total: migrations.length };
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
    await client.query('SELECT pg_advisory_unlock($1, $2)', lockKey);
  }
}

async function main() {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required.');
  const migrations = await readMigrations();
  const client = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const result = await applyMigrations(client, migrations);
    console.log(
      result.applied.length
        ? `Applied migrations: ${result.applied.join(', ')}.`
        : 'All migrations are already applied.',
    );
    console.log(`Verified ${result.total} migration checksum(s).`);
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))
) {
  main().catch((error) => {
    console.error(`Database migration failed: ${error.code ?? error.message}`);
    process.exitCode = 1;
  });
}
