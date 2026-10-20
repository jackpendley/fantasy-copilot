"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export interface AddDropMove {
  addId: number;
  addName: string;
  dropId: number | null;
  dropName: string | null;
  claim: boolean;
  /** "Waivers clear Tue 12:00 AM" when it's a claim. */
  claimNote: string | null;
  addsLeft: number;
  addsCap: number;
  /** Rest-of-season points given up (negative rosDelta), for the warning line. */
  rosCost: number;
}

export function AddDropButton({
  move,
  size = "sm",
}: {
  move: AddDropMove;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const verb = move.claim ? "Claim" : "Add";

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/waivers/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addId: move.addId, dropId: move.dropId }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) {
        toast.success(
          move.claim
            ? `Claim filed for ${move.addName}. It processes when waivers clear.`
            : `${move.addName} added${move.dropName ? `, ${move.dropName} dropped` : ""}. Set your lineup on Today.`,
        );
        if (out.auditError)
          toast.warning(`Done on ESPN, but the audit log failed: ${out.auditError}`);
        setOpen(false);
      } else if (res.status === 409) {
        toast.info(out.message ?? out.error);
        setOpen(false);
      } else {
        toast.error(
          `ESPN rejected it: ${out.code ?? res.status} ${out.message ?? out.error ?? ""}`,
        );
      }
    } catch (e) {
      // Unknown outcome: never retry blindly; refresh to see what ESPN has.
      toast.error(`No response (${(e as Error).message}). Refreshing to check ESPN.`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const disabled = !move.claim && move.addsLeft <= 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size={size}
          disabled={disabled}
          title={disabled ? "No adds left this week" : undefined}
        >
          {verb}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {verb} {move.addName}?
          </DialogTitle>
          <DialogDescription>This changes your real ESPN roster.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-sm">
          <li>
            <span className="font-medium text-success">Add</span> {move.addName}
            {move.claim && <span className="text-muted-foreground"> (waiver claim)</span>}
          </li>
          {move.dropName && (
            <li>
              <span className="font-medium text-danger">Drop</span> {move.dropName}
              <span className="text-muted-foreground">
                : other teams can claim him for 24 hours.
              </span>
            </li>
          )}
          <li className="text-muted-foreground">
            {move.claim
              ? (move.claimNote ?? "Claims process when waivers clear.")
              : `Uses 1 of your ${move.addsCap} adds this week (${move.addsLeft - 1} left after).`}
          </li>
          {move.rosCost > 20 && (
            <li className="text-warning">
              Costs about {Math.round(move.rosCost)} rest-of-season points: a short-term stream.
            </li>
          )}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Sending…" : `Confirm ${verb.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
