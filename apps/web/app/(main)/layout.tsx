import { PlayerCardProvider } from "@/components/fc/player-card";
import { BottomNav, SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayerCardProvider>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 pt-5 pb-28 md:pb-10">
        {children}
      </main>
      <BottomNav />
    </PlayerCardProvider>
  );
}
