// Players: Moves, Free agents and Trends under one header (title, search, tabs) that stays put
// while a view loads; each view is its own route, so only the open one loads its data.

import { Suspense } from "react";
import { PageHeader } from "@/components/fc/bits";
import { PlayerSearch } from "@/components/fc/player-search";
import { PlayersTabs } from "@/components/fc/players-nav";

export default function PlayersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Players" />
      <Suspense fallback={<PlayerSearch />}>
        <PlayerSearch fromUrl />
      </Suspense>
      <PlayersTabs />
      {children}
    </>
  );
}
