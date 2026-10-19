import "server-only";
import postgres from "postgres";

// One Postgres client per server instance, from DATABASE_URL (any provider; Neon in production).
// `prepare: false` keeps it compatible with transaction-mode connection poolers.
let client: postgres.Sql | null = null;

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

export function db(): postgres.Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    client = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
  }
  return client;
}
