import { Badge } from "@/components/ui/badge";
import { normalizeStatus } from "@fantasy-copilot/fantasy-core";

const LABEL: Record<string, string> = {
  OUT: "Out",
  INJURY_RESERVE: "IR",
  SUSPENSION: "Susp.",
  DOUBTFUL: "Doubtful",
  QUESTIONABLE: "Q",
  DAY_TO_DAY: "DTD",
  PROBABLE: "Prob.",
};

export function StatusBadge({ status, note }: { status: string; note?: string | null }) {
  const s = normalizeStatus(status);
  if (s === "ACTIVE") return null;
  const severe = s === "OUT" || s === "INJURY_RESERVE" || s === "SUSPENSION" || s === "DOUBTFUL";
  return (
    <Badge variant={severe ? "destructive" : "secondary"} title={note ?? undefined}>
      {LABEL[s] ?? status}
    </Badge>
  );
}
