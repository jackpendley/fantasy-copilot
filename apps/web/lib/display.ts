// Display helpers safe for client components (no server-only imports).

export const fmtPts = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export const SLOT_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "BE", "IR"];
export const slotRank = (slot: string) => {
  const i = SLOT_ORDER.indexOf(slot);
  return i === -1 ? SLOT_ORDER.length : i;
};

/** "J. Duren" for tight phone columns. */
export const shortName = (name: string) => {
  const [first, ...rest] = name.split(" ");
  return rest.length ? `${first![0]}. ${rest.join(" ")}` : name;
};
