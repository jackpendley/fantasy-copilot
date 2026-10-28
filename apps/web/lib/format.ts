import { DISPLAY_TZ } from "./env";

export { fmtPts, SLOT_ORDER, slotRank } from "./display";

export function fmtTip(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TZ,
  });
}
