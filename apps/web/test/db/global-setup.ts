// Before the tests: bring the test database's schema up to date with the app's own migration
// runner (scripts/migrate.ts), so the migrations are exercised too. Does nothing without
// TEST_DATABASE_URL.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { testDatabaseUrl } from "./test-db";

export default function setup() {
  const url = testDatabaseUrl();
  if (!url) return;
  execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
