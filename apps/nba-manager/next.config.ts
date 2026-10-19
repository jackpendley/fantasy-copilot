import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (no build step), so Next compiles them.
  transpilePackages: [
    "@fantasy-copilot/espn",
    "@fantasy-copilot/fantasy-core",
    "@fantasy-copilot/nba-data",
  ],
};

export default nextConfig;
