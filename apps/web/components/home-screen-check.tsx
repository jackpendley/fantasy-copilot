"use client";

// iOS keeps a Home Screen app's status-bar setting from when it was added (WebKit bug 260508):
// an app added before Nov 9 still runs under "black-translucent", which is what blurs the top
// and lifts the bottom tabs while a page loads (app/layout.tsx). Changing the page can't reach
// it, so this asks for the app to be added again. The old setting is recognizable: the page
// starts under the status bar, so the top safe-area inset is non-zero (0 with "default").

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Callout } from "@/components/fc/bits";

const DISMISSED = "home-screen-check-dismissed";

/** The installed iPhone app, laid out under the status bar (the old setting). */
function oldInstall(): boolean {
  if (!(navigator as { standalone?: boolean }).standalone) return false;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)";
  document.body.appendChild(probe);
  const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return top > 0;
}

export function HomeScreenCheck() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(DISMISSED) === "1";
    } catch {}
    // Read after mount: it depends on the device, and the server can't know it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!dismissed && oldInstall()) setShow(true);
  }, []);
  if (!show) return null;
  return (
    <Callout tone="warning">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">Add the app to your Home Screen again</p>
          <p className="text-muted-foreground">
            This icon still has an old iPhone setting that blurs the top and moves the tabs while a
            page loads. iPhone only reads it when the app is added. Delete this icon, open
            fantasycopilot.vercel.app in Safari, then Share → Add to Home Screen. You&apos;ll sign
            in once and turn alerts back on in Settings.
          </p>
        </div>
        <button
          type="button"
          aria-label="Hide for now"
          className="-m-1 rounded-md p-1 text-muted-foreground hover:text-foreground"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISSED, "1");
            } catch {}
            setShow(false);
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    </Callout>
  );
}
