"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface PendingMove {
  playerId: number;
  name: string;
  from: string;
  to: string;
}

export function ApplyMoves({ date, moves }: { date: string; moves: PendingMove[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    try {
      const res = await fetch("/api/lineup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          moves: moves.map(({ playerId, from, to }) => ({ playerId, from, to })),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) {
        toast.success(`ESPN lineup updated (${moves.length} moves)`);
        if (out.auditError)
          toast.warning(`Saved to ESPN, but the audit log failed: ${out.auditError}`);
        setOpen(false);
      } else if (res.status === 409 && out.error === "stale") {
        toast.info(out.message);
        setOpen(false);
      } else {
        toast.error(
          `ESPN rejected the moves: ${out.code ?? res.status} ${out.message ?? out.error ?? ""}`,
        );
      }
    } catch (e) {
      // Unknown outcome: never retry blindly, re-read instead.
      toast.error(`No response (${(e as Error).message}). Refreshing to check what ESPN has.`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full">
          Apply {moves.length} move{moves.length > 1 ? "s" : ""} to ESPN
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change your ESPN lineup?</DialogTitle>
          <DialogDescription>
            This updates your real team for this day. Players whose games have started are never
            moved.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          {moves.map((m) => (
            <li key={m.playerId} className="flex items-center gap-2">
              <span className="font-medium">{m.name}</span>
              <span className="text-muted-foreground">{m.from}</span>
              <ArrowRight className="size-3" />
              <span className="font-medium">{m.to}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={busy}>
            {busy ? "Applying…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
