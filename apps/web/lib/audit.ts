import "server-only";
// Every ESPN write is recorded with its request and ESPN's response (CLAUDE.md rule).
// Sink: the `espn_actions` table when DATABASE_URL is set; a local JSONL file in development.
// Production without a database has no sink, so writes are refused there.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { db, dbConfigured } from "./db";

export interface EspnAction {
  kind: "lineup" | "add-drop" | "waiver-claim";
  scoringPeriodId: number;
  request: unknown;
  ok: boolean;
  httpStatus: number;
  code: string;
  message: string;
  response: unknown;
}

const LOCAL_LOG = path.join(process.cwd(), "data", "local", "espn-actions.jsonl");

export function auditAvailable(): boolean {
  return dbConfigured() || process.env.NODE_ENV !== "production";
}

export async function recordAction(action: EspnAction): Promise<void> {
  const row = { at: new Date().toISOString(), ...action };
  if (dbConfigured()) {
    await db()`
      insert into espn_actions
        (kind, scoring_period_id, request, ok, http_status, code, message, response)
      values
        (${row.kind}, ${row.scoringPeriodId}, ${db().json(row.request as never)}, ${row.ok},
         ${row.httpStatus}, ${row.code}, ${row.message}, ${db().json((row.response ?? null) as never)})
    `;
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("no audit sink configured");
  await mkdir(path.dirname(LOCAL_LOG), { recursive: true });
  await appendFile(LOCAL_LOG, JSON.stringify(row) + "\n");
}
