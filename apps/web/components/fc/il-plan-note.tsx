import { describeReturn, type ReturnPlan } from "@/lib/nba/il-plan";
import { Callout } from "./bits";

/** The season model's plan for players coming back from the IR slot. */
export function IlPlanNote({ plan, who = "you'd" }: { plan: ReturnPlan[]; who?: string }) {
  if (!plan.length) return null;
  return (
    <Callout tone="info">
      <span className="font-medium">IL return plan</span>
      <ul className="mt-0.5 space-y-0.5">
        {plan.map((r) => (
          <li key={r.player.id}>{describeReturn(r, who)}.</li>
        ))}
      </ul>
      <span className="block text-xs text-muted-foreground">
        Season projections already include it: he counts from his estimated return, and the player
        he&apos;d replace stops counting that day.
      </span>
    </Callout>
  );
}
