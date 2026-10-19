import { redirect } from "next/navigation";

// League home. NBA is the only sport so far, so go straight to its daily lineup.
export default function Home() {
  redirect("/nba/today");
}
