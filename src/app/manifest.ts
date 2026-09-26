import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cold-Grid Shelter Triage Mesh",
    short_name: "Cold-Grid",
    description: "Real-time shelter triage, bed holds and overdose dispatch for Ottawa.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#05070a",
    theme_color: "#05070a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
