import type { MetadataRoute } from "next";

// Installable PWA (Add to Home Screen). iOS only delivers web push to installed apps.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fantasy Copilot",
    short_name: "Copilot",
    start_url: "/nba/today",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
