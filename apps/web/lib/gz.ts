import "server-only";
// JSON packed small for the database (gzip, then base64 text): big payloads cost database
// transfer every time they're read (db/migrations/0028_compressed_payloads.sql).

import { gunzipSync, gzipSync } from "node:zlib";

export const pack = (value: unknown): string => gzipSync(JSON.stringify(value)).toString("base64");

export const unpack = <T>(packed: string): T =>
  JSON.parse(gunzipSync(Buffer.from(packed, "base64")).toString("utf8")) as T;
