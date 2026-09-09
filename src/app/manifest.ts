import { APP_BASE_PATH, appPath } from "@/lib/app-path";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Monifactory Planner",
    short_name: "Monifactory Planner",
    description:
      "Factory planner and recipe calculator for Monifactory.",
    start_url: APP_BASE_PATH || "/",
    scope: APP_BASE_PATH || "/",
    display: "standalone",
    background_color: "#1b1d21",
    theme_color: "#1b1d21",
    icons: [
      { src: appPath("/icon-192.png"), sizes: "192x192", type: "image/png" },
      { src: appPath("/icon-512.png"), sizes: "512x512", type: "image/png" },
      {
        src: appPath("/icon-maskable-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
