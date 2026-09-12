-- Initialization for a fresh local/CI database. psql reads passwords from container environment.
\getenv database_name POSTGRES_DB
\getenv migrator_password RIDR_MIGRATOR_PASSWORD
\getenv api_password RIDR_API_PASSWORD

BEGIN;
CREATE ROLE ridr_migrator LOGIN PASSWORD :'migrator_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ridr_api LOGIN PASSWORD :'api_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Stand-ins for proving the private domain boundary without a hosted account.
CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;

REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"database_name" TO ridr_migrator;
GRANT CONNECT ON DATABASE :"database_name" TO ridr_api;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

CREATE SCHEMA ridr AUTHORIZATION ridr_migrator;
REVOKE ALL ON SCHEMA ridr FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ridr TO ridr_api;
ALTER ROLE ridr_migrator IN DATABASE :"database_name" SET search_path = pg_catalog;
ALTER ROLE ridr_api IN DATABASE :"database_name" SET search_path = pg_catalog;
ALTER DEFAULT PRIVILEGES FOR ROLE ridr_migrator IN SCHEMA ridr
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE ridr_migrator IN SCHEMA ridr
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE ridr_migrator
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
