import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — contract tests for MCP servers`,
    short_name: SITE.name,
    description: SITE.tagline,
    start_url: "/",
    display: "standalone",
    theme_color: "#FAF7F2",
    background_color: "#FAF7F2",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
