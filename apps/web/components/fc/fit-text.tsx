"use client";

// One line that never cuts off. On its own, a FitText whose text is wider than its space shrinks
// its font until it fits. Inside a FitGroup, the group shrinks all its text together instead:
// it finds the one scale at which every FitText in it fits and sets it as --fit, which the
// group's font sizes multiply by (text-[length:calc(12px*var(--fit,1))]). Rows stay alike: if
// one name needs smaller text, every name, game and stat line gets it too. Both re-fit when
// their space changes (rotation, resizing).

import { createContext, use, useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Group {
  register: (el: HTMLElement) => () => void;
  refit: () => void;
}

const FitGroupContext = createContext<Group | null>(null);

const shown = (el: HTMLElement) => el.getClientRects().length > 0;

export function FitGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const members = useRef(new Set<HTMLElement>());
  const queued = useRef(false);
  const fit = useCallback(() => {
    queued.current = false;
    const root = ref.current;
    if (!root) return;
    root.style.setProperty("--fit", "1");
    // Text scales, logos and padding don't: a few passes settle it.
    let scale = 1;
    for (let i = 0; i < 4; i++) {
      let worst = 1;
      for (const el of members.current) {
        if (shown(el) && el.scrollWidth > el.clientWidth) {
          worst = Math.min(worst, el.clientWidth / el.scrollWidth);
        }
      }
      if (worst >= 1) break;
      scale *= worst * 0.99;
      root.style.setProperty("--fit", scale.toFixed(4));
    }
  }, []);
  const [group] = useState<Group>(() => ({
    register: (el) => {
      members.current.add(el);
      return () => {
        members.current.delete(el);
      };
    },
    // Several lines changing in one render fit once, before the browser paints.
    refit: () => {
      if (queued.current) return;
      queued.current = true;
      queueMicrotask(fit);
    },
  }));
  useLayoutEffect(fit);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(fit);
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [fit]);
  return (
    <FitGroupContext value={group}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FitGroupContext>
  );
}

export function FitText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const group = use(FitGroupContext);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !group) return;
    const leave = group.register(el);
    group.refit();
    return () => {
      leave();
      group.refit();
    };
  }, [group, children]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || group) return;
    const fit = () => {
      el.style.fontSize = "";
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
  }, [group, children]);
  return (
    <span ref={ref} className={cn("block min-w-0 overflow-hidden whitespace-nowrap", className)}>
      {children}
    </span>
  );
}
