// Apply db/migrations/*.sql in order, each once, inside a transaction.
//   pnpm db:migrate        (reads DATABASE_URL from .env.local)
//   --production-only      what `pnpm build` passes: migrate only in a Vercel production
//                          build, so local, CI and preview builds never touch the live database.

import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";

if (process.argv.includes("--production-only") && process.env.VERCEL_ENV !== "production") {
  console.log("migrate: skipped (not a Vercel production build)");
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
const dir = new URL("../db/migrations/", import.meta.url);

await sql`create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`;
const done = new Set(
  (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
);

for (const file of readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  if (done.has(file)) {
    console.log(`skip   ${file}`);
    continue;
  }
  const body = readFileSync(new URL(file, dir), "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`insert into schema_migrations (name) values (${file})`;
  });
  console.log(`apply  ${file}`);
}
await sql.end();
