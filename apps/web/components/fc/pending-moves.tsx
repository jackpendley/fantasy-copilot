import { Callout } from "./bits";
import { hasPendingMoves, type PendingMoves } from "@/lib/nba/roster";

const names = (ps: { name: string }[]) => ps.map((p) => p.name).join(", ");

function describe(m: PendingMoves): string {
  return [
    m.adds.length && `+ ${names(m.adds)}`,
    m.drops.length && `− ${names(m.drops)}`,
    m.toIR.length && `${names(m.toIR)} → IL`,
    m.fromIR.length && `${names(m.fromIR)} back from IL`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Roster moves made after today's lock (the first tip): ESPN applies them tomorrow. Today's
 * lineup is unchanged; projections from tomorrow on already include them.
 */
export function PendingMovesNote({
  mine,
  theirs,
  opponent,
}: {
  mine: PendingMoves;
  theirs?: PendingMoves | null;
  opponent?: string;
}) {
  const showMine = hasPendingMoves(mine);
  const showTheirs = theirs && hasPendingMoves(theirs);
  if (!showMine && !showTheirs) return null;
  return (
    <Callout tone="info">
      <span className="font-medium">Takes effect tomorrow</span>
      {showMine && <> · You: {describe(mine)}</>}
      {showTheirs && (
        <>
          {" "}
          · {opponent ?? "Opponent"}: {describe(theirs!)}
        </>
      )}
      <span className="block text-xs text-muted-foreground">
        Moves made after today&apos;s first tip count from tomorrow. Projections and win odds
        already include them.
      </span>
    </Callout>
  );
}
