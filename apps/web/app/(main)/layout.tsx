import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-5">{children}</main>
    </>
  );
}
