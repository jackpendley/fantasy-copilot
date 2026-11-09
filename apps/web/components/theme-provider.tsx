"use client";

import { useEffect } from "react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";

/** The page background per theme (globals.css --background): the phone's status bar color. */
const BAR = { light: "#f6f7f9", dark: "#0a0e16" } as const;

/**
 * Keep the status bar the app's own color when the toggle overrides the device setting: the
 * layout's theme-color tags follow the device (prefers-color-scheme), so they're set to the
 * theme in use instead. The installed app has an opaque status bar (app/layout.tsx), so this
 * color is all that shows behind the clock.
 */
function ThemeColor() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.removeAttribute("media");
      meta.setAttribute("content", BAR[resolvedTheme]);
    }
  }, [resolvedTheme]);
  return null;
}

/** Dark by default; the toggle can pick light or follow the device. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <ThemeColor />
      {children}
    </NextThemes>
  );
}
