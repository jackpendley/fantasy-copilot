// The database the queue tests run against: TEST_DATABASE_URL, never DATABASE_URL (which may
// point at production in .env.local). The tests truncate tables, so the database's name must
// end in "_test". Without it the database tests are skipped.
//   createdb fantasy_copilot_test
//   TEST_DATABASE_URL=postgres://localhost/fantasy_copilot_test pnpm test

export function testDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL must name a database ending in "_test" (got "${name}")`);
  }
  return url;
}
