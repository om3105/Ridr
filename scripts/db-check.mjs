import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { applyMigrations, readMigrations } from './db-migrate.mjs';

async function expectDenied(client, sql, label) {
  await assert.rejects(client.query(sql), { code: '42501' }, label);
}

async function main() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Set NODE_ENV=test and use a dedicated test database.');
  if (!process.env.DATABASE_URL || !process.env.MIGRATION_DATABASE_URL) {
    throw new Error('DATABASE_URL and MIGRATION_DATABASE_URL are required.');
  }
  const api = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  const owner = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await Promise.all([api.connect(), owner.connect()]);
    const migrations = await readMigrations();
    const before = (await owner.query('SELECT * FROM ridr.schema_migrations ORDER BY version'))
      .rows;
    const result = await applyMigrations(owner, migrations);
    assert.deepEqual(result.applied, [], 'Run db:migrate before db:check.');
    assert.deepEqual(
      (await owner.query('SELECT * FROM ridr.schema_migrations ORDER BY version')).rows,
      before,
    );
    await assert.rejects(
      applyMigrations(
        owner,
        migrations.map((migration, index) =>
          index === 0 ? { ...migration, checksum: '0'.repeat(64) } : migration,
        ),
      ),
      /was changed/,
    );
    await assert.rejects(applyMigrations(owner, []), /missing from this checkout/);
    await assert.rejects(
      applyMigrations(owner, [
        ...migrations,
        {
          version: '999_rollback_check',
          checksum: 'f'.repeat(64),
          sql: 'CREATE TABLE ridr.migration_rollback_check (id integer); SELECT * FROM ridr.missing_rollback_relation;',
        },
      ]),
      { code: '42P01' },
    );
    assert.equal(
      (await owner.query("SELECT to_regclass('ridr.migration_rollback_check') AS relation")).rows[0]
        .relation,
      null,
    );
    assert.deepEqual(
      (await owner.query('SELECT * FROM ridr.schema_migrations ORDER BY version')).rows,
      before,
    );
    console.log(
      'PASS: migration rerun, checksum drift, missing history and failed migration rollback.',
    );

    const {
      rows: [role],
    } = await api.query(`
      SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `);
    assert.deepEqual(role, {
      name: 'ridr_api',
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
    });
    assert.equal(
      (
        await api.query(
          "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'ridr' AND tablename <> 'schema_migrations'",
        )
      ).rows[0].count,
      29,
    );
    assert.equal(
      (
        await api.query(
          "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'ridr' AND tableowner <> 'ridr_migrator'",
        )
      ).rows[0].count,
      0,
    );
    await api.query('SELECT version FROM ridr.schema_migrations');
    await expectDenied(
      api,
      'CREATE TABLE ridr.forbidden (id integer)',
      'Runtime cannot create domain tables.',
    );
    await expectDenied(
      api,
      'CREATE TABLE public.forbidden (id integer)',
      'Runtime cannot create public tables.',
    );
    await expectDenied(
      api,
      'ALTER TABLE ridr.profiles ADD COLUMN forbidden integer',
      'Runtime cannot alter domain tables.',
    );
    await expectDenied(
      api,
      'TRUNCATE ridr.schema_migrations',
      'Runtime cannot truncate migration history.',
    );
    await expectDenied(
      api,
      "INSERT INTO ridr.schema_migrations(version, checksum) VALUES ('999_forbidden', repeat('0', 64))",
      'Runtime cannot insert migration history.',
    );
    await expectDenied(
      api,
      'UPDATE ridr.schema_migrations SET applied_at = now()',
      'Runtime cannot update migration history.',
    );
    await expectDenied(
      api,
      'DELETE FROM ridr.schema_migrations',
      'Runtime cannot delete migration history.',
    );
    await expectDenied(api, 'SET ROLE ridr_migrator', 'Runtime cannot become the owner.');

    const id = randomUUID();
    await api.query('BEGIN');
    await api.query('INSERT INTO ridr.profiles (id, display_name) VALUES ($1, $2)', [
      id,
      'Database check',
    ]);
    await api.query('UPDATE ridr.profiles SET display_name = $2 WHERE id = $1', [
      id,
      'Updated check',
    ]);
    assert.equal(
      (await api.query('SELECT display_name FROM ridr.profiles WHERE id = $1', [id])).rows[0]
        .display_name,
      'Updated check',
    );
    await api.query('DELETE FROM ridr.profiles WHERE id = $1', [id]);
    await api.query('ROLLBACK');
    for (const deniedRole of ['anon', 'authenticated']) {
      const {
        rows: [access],
      } = await owner.query(
        `
        SELECT has_schema_privilege($1, 'ridr', 'USAGE') AS usage,
               has_schema_privilege($1, 'ridr', 'CREATE') AS create,
               has_table_privilege($1, 'ridr.profiles', 'SELECT') AS read
      `,
        [deniedRole],
      );
      assert.deepEqual(access, { usage: false, create: false, read: false });
    }
    assert.equal(
      (
        await owner.query(`
      SELECT count(*)::int AS count FROM pg_namespace n,
      LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
      WHERE n.nspname = 'ridr' AND a.grantee = 0
    `)
      ).rows[0].count,
      0,
    );
    await owner.query('BEGIN');
    await owner.query('CREATE TABLE ridr.default_grants_check (id integer)');
    for (const deniedRole of ['anon', 'authenticated', 'ridr_api']) {
      assert.equal(
        (
          await owner.query(
            "SELECT has_table_privilege($1, 'ridr.default_grants_check', 'SELECT') AS allowed",
            [deniedRole],
          )
        ).rows[0].allowed,
        false,
      );
    }
    await owner.query('ROLLBACK');
    console.log(
      'PASS: 29 domain tables, runtime CRUD, separate ownership and private role boundaries.',
    );

    const {
      rows: [spatial],
    } = await api.query(`
      SELECT public.postgis_version() AS version,
        public.ST_Distance(
          public.ST_SetSRID(public.ST_MakePoint(0, 0), 4326)::public.geography,
          public.ST_SetSRID(public.ST_MakePoint(0, 1), 4326)::public.geography
        ) AS metres
    `);
    assert.ok(
      spatial.metres > 110000 && spatial.metres < 111000,
      'PostGIS must calculate a real geography distance in metres.',
    );
    console.log(`PASS: PostGIS ${spatial.version} geography distance calculation.`);

    const checks = await readFile(
      new URL('../docs/day-03/schema-checks.sql', import.meta.url),
      'utf8',
    );
    const outputs = await owner.query(checks);
    const integrityMessage = outputs
      .flatMap((output) => output.rows ?? [])
      .flatMap(Object.values)
      .find((value) => typeof value === 'string' && value.startsWith('PASS: '));
    assert.equal(integrityMessage, 'PASS: 24 database integrity cases');
    console.log(integrityMessage);
  } finally {
    await Promise.allSettled([api.query('ROLLBACK'), owner.query('ROLLBACK')]);
    await Promise.allSettled([api.end(), owner.end()]);
  }
}

main().catch((error) => {
  console.error(`Database checks failed: ${error.code ?? error.message}`);
  process.exitCode = 1;
});
