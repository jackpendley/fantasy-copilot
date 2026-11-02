// The season outlook is part of the League page now. Old links and bookmarks land there.

import { redirect } from "next/navigation";

export default function OutlookRedirect() {
  redirect("/nba/league");
}
