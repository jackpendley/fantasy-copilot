import type { MetadataRoute } from "next";

// Installable PWA (Add to Home Screen). iOS only delivers web push to installed apps.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fantasy Copilot",
    short_name: "Copilot",
    start_url: "/nba/today",
    display: "standalone",
    // The dark theme's background (the default): the launch screen and status bar match it.
    background_color: "#0a0e16",
    theme_color: "#0a0e16",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
