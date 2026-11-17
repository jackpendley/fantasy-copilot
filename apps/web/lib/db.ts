import "server-only";
import postgres from "postgres";

// One Postgres client per server instance, from DATABASE_URL (any provider; Neon in production).
// `prepare: false` keeps it compatible with transaction-mode connection poolers.
let client: postgres.Sql | null = null;

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

/**
 * Queries this server instance has sent (docs/COMPUTE.md §10): a scheduled job compares it
 * before and after to tell whether it woke Neon, whose compute bills by the minute awake.
 */
export const dbUse = { queries: 0 };

/**
 * With DB_TRAFFIC_LOG=1: each query's result size (estimated from its JSON), by the start of its
 * SQL, logged once a minute. It finds which reads use Neon's network transfer; leave it off
 * otherwise (it costs CPU).
 */
const traffic = new Map<string, { n: number; bytes: number }>();
let flushedAt = Date.now();

function tally(label: string, result: unknown) {
  const t = traffic.get(label) ?? { n: 0, bytes: 0 };
  t.n++;
  t.bytes += JSON.stringify(result)?.length ?? 0;
  traffic.set(label, t);
  if (Date.now() - flushedAt < 60_000) return;
  const top = [...traffic].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 12);
  console.log(
    `[db-traffic] ${top.map(([l, x]) => `${(x.bytes / 1024).toFixed(0)} KB ×${x.n} ${l}`).join(" | ")}`,
  );
  traffic.clear();
  flushedAt = Date.now();
}

export function db(): postgres.Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
    const log = process.env.DB_TRAFFIC_LOG === "1";
    // Tagged-template calls are queries; other calls (`db()(rows, ...)`) build fragments.
    client = new Proxy(sql, {
      apply(target, self, args: unknown[]) {
        const q = Reflect.apply(target, self, args);
        const strings = args[0] as TemplateStringsArray | undefined;
        if (!Array.isArray(strings) || !("raw" in strings)) return q;
        dbUse.queries++;
        if (log) {
          const label = strings[0]!.replace(/\s+/g, " ").trim().slice(0, 60);
          const then = q.then.bind(q);
          q.then = (ok?: (r: unknown) => unknown, fail?: (e: unknown) => unknown) =>
            then((r: unknown) => {
              tally(label, r);
              return ok ? ok(r) : r;
            }, fail);
        }
        return q;
      },
    });
  }
  return client;
}
