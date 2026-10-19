"use client";

import { ThemeProvider as NextThemes } from "next-themes";

/** Dark by default; the toggle can pick light or follow the device. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}
