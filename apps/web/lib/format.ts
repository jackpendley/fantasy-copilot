import { DISPLAY_TZ } from "./env";

export { fmtPts, SLOT_ORDER, slotRank } from "./display";

export function fmtTip(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TZ,
  });
}

/** "11-01 7:10 PM": month-day and time, both in Jack's time zone. */
export function fmtDayTime(at: Date | string): string {
  const d = new Date(at);
  const md = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    timeZone: DISPLAY_TZ,
  })
    .format(d)
    .replace("/", "-");
  return `${md} ${fmtTip(d.toISOString())}`;
}
