import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (no build step), so Next compiles them.
  transpilePackages: [
    "@fantasy-copilot/espn",
    "@fantasy-copilot/fantasy-core",
    "@fantasy-copilot/nba-data",
  ],
  // Pre-rename URLs (home-screen bookmarks): query strings carry over.
  async redirects() {
    return [
      { source: "/today", destination: "/nba/today", permanent: false },
      { source: "/week", destination: "/nba/week", permanent: false },
    ];
  },
};

export default nextConfig;
