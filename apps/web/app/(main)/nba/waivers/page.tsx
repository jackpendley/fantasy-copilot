// Waivers is now Players → Moves (and Players → Free agents for the table). Old links and
// bookmarks land on the right one.

import { redirect } from "next/navigation";

export default async function WaiversRedirect({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string; sort?: string }>;
}) {
  const { pos, sort } = await searchParams;
  if (pos || sort) {
    const q = new URLSearchParams();
    if (pos) q.set("pos", pos);
    if (sort) q.set("sort", sort);
    redirect(`/nba/players/free-agents?${q}`);
  }
  redirect("/nba/players");
}
