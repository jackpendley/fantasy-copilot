"use client";

// One line that never cuts off: when its text is wider than the space it has, the font shrinks
// until it fits (re-fitted when the space changes, e.g. on rotation).

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function FitText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      // Text scales with the font, a logo doesn't: a few passes settle it.
      for (let i = 0; i < 4 && el.scrollWidth > el.clientWidth; i++) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = `${(size * el.clientWidth * 0.99) / el.scrollWidth}px`;
      }
    };
    fit();
    // Watch the space it lives in (its own size changes as it fits).
    const observer = new ResizeObserver(fit);
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [children]);
  return (
    <span ref={ref} className={cn("block min-w-0 overflow-hidden whitespace-nowrap", className)}>
      {children}
    </span>
  );
}
