import { describe, expect, it } from "vitest";
import {
  easternToIso,
  injuryReportFiles,
  parseInjuryReport,
  type TextItem,
} from "../src/injury-report";

// Synthetic report laid out like the league's PDF (column x positions from a real report; the
// players are made up). y grows upward; a long reason wraps above and below its row.
const at = (page: number, y: number, cells: [number, string][]): TextItem[] =>
  cells.map(([x, str]) => ({ str, x, y, page }));
const ITEMS: TextItem[] = [
  ...at(1, 533, [[289, "Injury Report: 01/15/25 06:30 PM"]]),
  ...at(1, 480, [
    [23, "Game"],
    [53, "Date"],
    [120, "Game"],
    [149, "Time"],
    [200, "Matchup"],
    [264, "Team"],
    [425, "Player"],
    [457, "Name"],
    [586, "Current"],
    [624, "Status"],
    [666, "Reason"],
  ]),
  ...at(1, 459, [[667, "Injury/Illness - Right Shoulder;"]]),
  ...at(1, 452, [
    [24, "01/15/2025"],
    [121, "07:00 (ET)"],
    [201, "NYK@PHI"],
    [265, "New York Knicks"],
    [426, "Guard, Test"],
    [587, "Questionable"],
  ]),
  ...at(1, 445, [[667, "Soreness"]]),
  ...at(1, 430, [
    [426, "Wing Jr., Sample"],
    [587, "Out"],
    [667, "G League - Two-Way"],
  ]),
  ...at(1, 408, [
    [265, "Philadelphia 76ers"],
    [426, "Center, Demo"],
    [587, "Available"],
    [667, "Injury/Illness - Left Knee; Soreness"],
  ]),
  ...at(1, 386, [
    [121, "10:30 (ET)"],
    [201, "MIA@LAC"],
    [265, "Miami Heat"],
    [667, "NOT YET SUBMITTED"],
  ]),
  ...at(1, 50, [[396, "Page 1 of 2"]]),
  // Page 2 has no header; the last game's group continues.
  ...at(2, 533, [[289, "Injury Report: 01/15/25 06:30 PM"]]),
  ...at(2, 505, [
    [265, "LA Clippers"],
    [426, "Forward, Example"],
    [587, "Doubtful"],
    [667, "Rest"],
  ]),
];

describe("parseInjuryReport", () => {
  const report = parseInjuryReport(ITEMS)!;

  it("reads the printed publish time as Eastern", () => {
    expect(report.publishedAt).toBe("2025-01-15T23:30:00.000Z");
  });

  it("reads each player with his game, team and status, carrying groups forward", () => {
    expect(
      report.entries.map((e) => [e.name, e.teamAbbr, e.matchup, e.gameTime, e.status]),
    ).toEqual([
      ["Test Guard", "NYK", "NYK@PHI", "19:00", "Questionable"],
      ["Sample Wing Jr.", "NYK", "NYK@PHI", "19:00", "Out"],
      ["Demo Center", "PHI", "NYK@PHI", "19:00", "Available"],
      ["Example Forward", "LAC", "MIA@LAC", "22:30", "Doubtful"],
    ]);
    expect(report.entries.every((e) => e.gameDate === "2025-01-15")).toBe(true);
  });

  it("joins a reason wrapped around its row, and skips teams not yet submitted", () => {
    expect(report.entries[0]!.reason).toBe("Injury/Illness - Right Shoulder; Soreness");
    expect(report.entries[1]!.reason).toBe("G League - Two-Way");
    expect(report.entries.some((e) => e.team === "Miami Heat")).toBe(false);
  });

  it("returns null for something that isn't a report", () => {
    expect(parseInjuryReport(at(1, 500, [[10, "Hello"]]))).toBeNull();
  });
});

describe("report times and files", () => {
  it("converts Eastern wall time across daylight saving", () => {
    expect(easternToIso("2025-01-15", 18, 30)).toBe("2025-01-15T23:30:00.000Z");
    expect(easternToIso("2026-10-28", 17, 0)).toBe("2026-10-28T21:00:00.000Z");
  });

  it("names quarter-hour files, and the older hourly file for :30", () => {
    expect(injuryReportFiles("2026-10-28", 17, 0)).toEqual([
      "Injury-Report_2026-10-28_05_00PM.pdf",
    ]);
    expect(injuryReportFiles("2025-01-15", 18, 30)).toEqual([
      "Injury-Report_2025-01-15_06_30PM.pdf",
      "Injury-Report_2025-01-15_06PM.pdf",
    ]);
    expect(injuryReportFiles("2025-01-15", 11, 30)[1]).toBe("Injury-Report_2025-01-15_11AM.pdf");
    expect(injuryReportFiles("2025-01-15", 12, 15)).toEqual([
      "Injury-Report_2025-01-15_12_15PM.pdf",
    ]);
  });
});
