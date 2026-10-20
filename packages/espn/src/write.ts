// ESPN lineup writes. These change the user's real team: callers must only invoke them from
// an explicit user confirmation and must audit every call (see CLAUDE.md).
//
// Shape follows what ESPN's own lineup UI sends (community-documented; ESPN has no public
// API): one ROSTER transaction with a LINEUP item per moved player, so a swap is applied as
// a whole. There is no dry run and no idempotency key: never retry blindly; re-read first.

import type { EspnConfig } from "./client";
import { SLOT_ID_BY_NAME, WRITE_HOST } from "./constants";

export interface LineupMove {
  playerId: number;
  /** Slot names as the app uses them ("BE", "UTIL", "PG", ...). */
  from: string;
  to: string;
}

export function lineupTransactionBody(
  cfg: EspnConfig,
  teamId: number,
  scoringPeriodId: number,
  moves: readonly LineupMove[],
) {
  const items = moves.map((m) => {
    const fromLineupSlotId = SLOT_ID_BY_NAME[m.from];
    const toLineupSlotId = SLOT_ID_BY_NAME[m.to];
    if (fromLineupSlotId == null || toLineupSlotId == null) {
      throw new Error(`unknown slot in move ${m.from} -> ${m.to}`);
    }
    if (fromLineupSlotId === toLineupSlotId) throw new Error(`no-op move for ${m.playerId}`);
    return { playerId: m.playerId, type: "LINEUP", fromLineupSlotId, toLineupSlotId };
  });
  if (!items.length) throw new Error("no moves");
  return {
    isLeagueManager: false,
    teamId,
    type: "ROSTER",
    memberId: cfg.swid,
    scoringPeriodId,
    executionType: "EXECUTE",
    items,
  };
}

export interface WriteResult {
  ok: boolean;
  httpStatus: number;
  /** ESPN's transaction status on success (e.g. "EXECUTED"), or its error type. */
  code: string;
  message: string;
  response: unknown;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function readError(body: any): { code: string; message: string } {
  const d = body?.details?.[0] ?? {};
  return {
    code: d.type ?? body?.type ?? "UNKNOWN",
    message: d.message ?? body?.messages?.[0] ?? "",
  };
}

export async function submitLineup(
  cfg: EspnConfig,
  teamId: number,
  scoringPeriodId: number,
  moves: readonly LineupMove[],
  fetchImpl: typeof fetch = fetch,
): Promise<WriteResult> {
  return postTransaction(
    cfg,
    lineupTransactionBody(cfg, teamId, scoringPeriodId, moves),
    fetchImpl,
  );
}

async function postTransaction(
  cfg: EspnConfig,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<WriteResult> {
  const url = `${WRITE_HOST}/apis/v3/games/${cfg.game ?? "fba"}/seasons/${cfg.season}/segments/0/leagues/${cfg.leagueId}/transactions/`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Cookie: `espn_s2=${cfg.s2}; SWID=${cfg.swid}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (
    res.ok &&
    (json?.status === "EXECUTED" || json?.status === "PENDING" || json?.status == null)
  ) {
    return {
      ok: true,
      httpStatus: res.status,
      code: json?.status ?? "OK",
      message: "",
      response: json,
    };
  }
  const err = readError(json);
  return {
    ok: false,
    httpStatus: res.status,
    code: err.code,
    message: err.message,
    response: json,
  };
}

/**
 * Add a player (dropping one, unless there's an open roster spot). A FREEAGENT add takes
 * effect immediately; a WAIVER claim is queued until the player's waiver period ends.
 */
export function addDropBody(
  cfg: EspnConfig,
  teamId: number,
  scoringPeriodId: number,
  move: { addId: number; dropId: number | null; claim: boolean },
) {
  const items: Record<string, unknown>[] = [
    { playerId: move.addId, type: "ADD", toTeamId: teamId },
  ];
  if (move.dropId != null) items.push({ playerId: move.dropId, type: "DROP", fromTeamId: teamId });
  return {
    isLeagueManager: false,
    teamId,
    type: move.claim ? "WAIVER" : "FREEAGENT",
    memberId: cfg.swid,
    scoringPeriodId,
    executionType: "EXECUTE",
    items,
  };
}

export async function submitAddDrop(
  cfg: EspnConfig,
  teamId: number,
  scoringPeriodId: number,
  move: { addId: number; dropId: number | null; claim: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<WriteResult> {
  return postTransaction(cfg, addDropBody(cfg, teamId, scoringPeriodId, move), fetchImpl);
}
