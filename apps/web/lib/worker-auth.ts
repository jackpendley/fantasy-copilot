import "server-only";
import type { NextRequest } from "next/server";

/** The simulation worker's requests carry `Authorization: Bearer WORKER_SECRET`. */
export function workerAuthorized(request: NextRequest): boolean {
  const secret = process.env.WORKER_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
