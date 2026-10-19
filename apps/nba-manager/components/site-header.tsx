import Link from "next/link";

const NAV = [
  { href: "/today", label: "Today" },
  { href: "/week", label: "Week" },
];

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3">
        <Link href="/today" className="font-semibold">
          Hoops Manager
        </Link>
        <nav className="flex gap-3 text-sm text-muted-foreground">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
