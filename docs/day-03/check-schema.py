"""Verify the reference DDL in an isolated, temporary PostgreSQL cluster.

Requires initdb, pg_ctl and psql on PATH. Does not connect to an existing server.
This checks database constraints, not application authorization or concurrency.
"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    for command in ("initdb", "pg_ctl", "psql"):
        if not shutil.which(command):
            raise SystemExit(f"Required PostgreSQL executable missing: {command}")
    folder = Path(__file__).resolve().parent
    # Keep Unix socket paths short and all cluster files private to this run.
    with tempfile.TemporaryDirectory(prefix="ridr-day3-") as temporary:
        work = Path(temporary)
        cluster = work / "db"
        environment = {
            **os.environ,
            "PGHOST": str(work),
            "PGPORT": "55433",
            "PGDATABASE": "postgres",
            "PGUSER": "ridr_design_check",
        }
        started = False

        def run(arguments, **kwargs):
            result = subprocess.run(
                arguments, env=environment, text=True, capture_output=True, **kwargs
            )
            if result.returncode:
                raise RuntimeError(result.stderr or result.stdout)
            return result.stdout

        try:
            run([
                "initdb", "-D", str(cluster), "-U", "ridr_design_check",
                "--auth=trust", "--no-locale", "--encoding=UTF8",
            ])
            run([
                "pg_ctl", "-D", str(cluster), "-l", str(work / "server.log"),
                "-o", f"-F -k {work} -h '' -p 55433", "-w", "start",
            ])
            started = True
            run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-f", str(folder / "schema.sql")])
            output = run([
                "psql", "-X", "-v", "ON_ERROR_STOP=1", "-f", str(folder / "schema-checks.sql")
            ])
            version = run(["psql", "-X", "-Atc", "select version()"])
            count = run([
                "psql", "-X", "-Atc",
                "select count(*) from information_schema.tables where table_schema = 'ridr'",
            ])
            print(version.strip())
            print(f"PASS: reference DDL created {count.strip()} tables in an isolated database.")
            for line in output.splitlines():
                if line.strip().startswith("PASS:"):
                    print(line.strip())
        finally:
            if started:
                run(["pg_ctl", "-D", str(cluster), "-m", "immediate", "-w", "stop"])


if __name__ == "__main__":
    main()
