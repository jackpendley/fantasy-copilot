import { DISPLAY_TZ } from "./env";

export const fmtPts = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function fmtTip(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TZ,
  });
}

export const SLOT_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "BE", "IR"];
export const slotRank = (slot: string) => {
  const i = SLOT_ORDER.indexOf(slot);
  return i === -1 ? SLOT_ORDER.length : i;
};
