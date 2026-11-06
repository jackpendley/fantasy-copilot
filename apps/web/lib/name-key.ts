// Player names compared across sources (ESPN, PBP Stats, DARKO, draft rankings). Pure.

/** "Ja'Kobe Walter Jr." and "Jakobe Walter" both become "jakobe walter". */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}
