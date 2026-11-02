"use client";

// Search as you type. The first focus loads every player once (/api/players/index, ~1,000
// names); each keystroke then searches that list in the browser, so results appear instantly
// with no request per letter. ↑/↓ move through results, Enter opens the player's card (or,
// with nothing highlighted, the full results page), Esc clears. Without JavaScript the box is
// a plain form that loads ?q= results.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { usePlayerCard } from "@/components/fc/player-card";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { fmtPts } from "@/lib/display";
import { searchPlayers, type SearchHit, type SearchPlayer } from "@/lib/player-search";
import { cn } from "@/lib/utils";

let index: Promise<SearchPlayer[]> | null = null;
function loadIndex(): Promise<SearchPlayer[]> {
  index ??= fetch("/api/players/index")
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()) as { players: SearchPlayer[] }).players;
    })
    .catch((e) => {
      index = null;
      throw e;
    });
  return index;
}

function Highlighted({ hit }: { hit: SearchHit }) {
  const name = hit.player.name;
  if (!hit.highlight) return <>{name}</>;
  const [a, b] = hit.highlight;
  return (
    <>
      {name.slice(0, a)}
      <mark className="rounded-sm bg-primary/20 text-foreground">{name.slice(a, b)}</mark>
      {name.slice(b)}
    </>
  );
}

export function PlayerSearch({ initial = "" }: { initial?: string }) {
  const card = usePlayerCard();
  const listId = useId();
  const [q, setQ] = useState(initial);
  const [players, setPlayers] = useState<SearchPlayer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLFormElement>(null);

  const hits = useMemo(() => (players ? searchPlayers(players, q) : []), [players, q]);

  const prepare = () => {
    if (players) return;
    loadIndex().then(setPlayers, () => setFailed(true));
  };

  // Close when tapping elsewhere.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const choose = (hit: SearchHit) => {
    setOpen(false);
    card?.open(hit.player.id);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === "Enter" && open && active >= 0 && hits[active]) {
      e.preventDefault();
      choose(hits[active]);
    } else if (e.key === "Escape") {
      if (open && q) setOpen(false);
      else setQ("");
    }
  };

  const showList = open && q.trim().length > 0;
  return (
    <form ref={box} action="/nba/players" className="relative" role="search">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        name="q"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(-1);
          setOpen(true);
          prepare();
        }}
        onFocus={() => {
          prepare();
          setOpen(true);
        }}
        onKeyDown={onKey}
        placeholder="Search any player"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        className="h-10 w-full rounded-lg border bg-card pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {showList && (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-11 z-30 overflow-hidden rounded-lg border bg-popover shadow-lg"
        >
          {!players && (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              {failed ? "Couldn't load players. Press Enter to search." : "Loading players…"}
            </p>
          )}
          {players && !hits.length && (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">No player matches.</p>
          )}
          {hits.map((h, i) => (
            <div
              key={h.player.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(h)}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 px-3 py-2",
                i === active && "bg-muted",
              )}
            >
              <PlayerAvatar id={h.player.id} name={h.player.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-medium break-words">
                    <Highlighted hit={h} />
                  </span>
                  <StatusPill status={h.player.status} />
                </div>
                <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                  <TeamLogo abbr={h.player.team} size={12} />
                  {h.player.positions.join("/")} ·{" "}
                  <span
                    className={cn(
                      h.player.mine && "font-medium text-success",
                      h.player.available && "text-info",
                    )}
                  >
                    {h.player.owner}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <div className="text-sm font-semibold">{fmtPts(h.player.fppg)}</div>
                <div className="text-[10px] text-muted-foreground">FP/G</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
