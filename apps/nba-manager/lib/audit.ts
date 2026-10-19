import "server-only";
// Every ESPN write is recorded with its request and ESPN's response (CLAUDE.md rule).
// Sink: Supabase `espn_actions` when configured; a local JSONL file in development.
// Production without Supabase has no sink, so writes are refused there.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { supabase, supabaseConfigured } from "./supabase";

export interface EspnAction {
  kind: "lineup";
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
  return supabaseConfigured() || process.env.NODE_ENV !== "production";
}

export async function recordAction(action: EspnAction): Promise<void> {
  const row = { at: new Date().toISOString(), ...action };
  if (supabaseConfigured()) {
    const { error } = await supabase().from("espn_actions").insert({
      kind: row.kind,
      scoring_period_id: row.scoringPeriodId,
      request: row.request,
      ok: row.ok,
      http_status: row.httpStatus,
      code: row.code,
      message: row.message,
      response: row.response,
    });
    if (error) throw new Error(`audit insert failed: ${error.message}`);
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("no audit sink configured");
  await mkdir(path.dirname(LOCAL_LOG), { recursive: true });
  await appendFile(LOCAL_LOG, JSON.stringify(row) + "\n");
}
