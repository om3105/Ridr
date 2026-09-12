# Local database

The local test environment uses PostgreSQL with PostGIS. `init/01-roles.sql` runs
only during fresh container initialization. It needs `POSTGRES_USER`,
`POSTGRES_DB`, `RIDR_MIGRATOR_PASSWORD` and `RIDR_API_PASSWORD`. These are supplied
through the local environment, never through committed credentials. Changing
them after a volume has been initialized does not rotate existing passwords.

`ridr_migrator` owns the private `ridr` schema and its tables. `ridr_api` can read,
insert, update and delete domain rows, and can only read the migration ledger.
It cannot create or alter tables, truncate the ledger or become the owner.
`PUBLIC`, `anon` and `authenticated` have no private schema access. The last two
roles are local stand-ins; this is not a hosted Supabase configuration or a
verification of its Data API or Storage policies. No public HTTP database API is
started by this environment.

Run `npm run db:migrate` with `MIGRATION_DATABASE_URL` set to a connection for
`ridr_migrator`. The runner holds an advisory lock, verifies existing SHA-256
checksums, and commits each migration together with its ledger record. It stops
on modified or missing applied migrations and out-of-order pending versions.
Never edit an applied migration: add the next `NNN_description.sql` file. SQL
files omit transaction wrappers because the runner controls rollback. A failed
migration rolls back its own changes, leaving earlier successful versions intact.

The initial migration promotes the 29-table Day 3 reference schema. It adds
runtime permissions; the ledger is a separate thirtieth table. PostGIS is
installed by the database administrator during initialization. The runtime can
call qualified `public.ST_*` functions. Spatial projections and indexes will be
added with the queries that need them; existing coordinates retain their finite
range checks. All domain queries must qualify `ridr.*` because the login search
path contains only `pg_catalog`.

Run `NODE_ENV=test npm run test:database` against the dedicated local or CI database
after migrations, with both database URLs available. It checks migration reruns
and drift detection, real role permissions, backend CRUD, a PostGIS geography
distance and the 24 Day 3 integrity cases. Sample rows are rolled back. These
checks do not prove application authorization, ride concurrency or later purge
workers; those remain feature work. The script refuses to run without the
explicit test environment flag.
