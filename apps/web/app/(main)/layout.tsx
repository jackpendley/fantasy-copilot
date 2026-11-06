import { PlayerCardProvider } from "@/components/fc/player-card";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { BottomNav, SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayerCardProvider>
      <SiteHeader />
      <PullToRefresh />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 pt-5 pb-28 lg:pb-10">
        {children}
      </main>
      <BottomNav />
    </PlayerCardProvider>
  );
}
