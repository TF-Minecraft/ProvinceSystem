import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // ProvinceSystem root so ../shared/skins constants resolve under turbopack.
  // Docker copies shared → /shared (see frontend/Dockerfile).
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  devIndicators: false,
  // The app does not use next/image; disable the image optimizer endpoint
  // as defense in depth against Image Optimization API advisories.
  images: {
    unoptimized: true,
  },
  // Next 16.3's build-time check runs the project's own `tsc` CLI, which checks
  // every file included by tsconfig, including tests. Use tsconfig.build.json
  // to fully type-check shipped application code without requiring test files
  // to type-check for `next build`.
  typescript: {
    tsconfigPath: "tsconfig.build.json",
  },
  async redirects() {
    return [
      // Account became Profile's Linked accounts tab; Next carries the query (sign-in and link notices) across.
      { source: "/account", destination: "/profile?tab=accounts", permanent: false },
      // The character list lives on Profile's Characters tab.
      { source: "/character", destination: "/profile", permanent: false },
      // Skins and drinks are made and followed on Profile. Ids are slugs, so /skins/skin.png and
      // /drinks/assets/* (public files) don't match.
      { source: "/skins", destination: "/profile?tab=skins", permanent: false },
      { source: "/skins/:id([a-z][a-z0-9_]{1,47})", destination: "/profile/skins/:id", permanent: false },
      { source: "/drinks", destination: "/profile?tab=drinks", permanent: false },
      { source: "/drinks/:id([a-z][a-z0-9_]{1,47})", destination: "/profile/drinks/:id", permanent: false },
      // Staff tools that moved into the staff panel.
      { source: "/precedent", destination: "/admin/precedent", permanent: false },
      { source: "/inspect", destination: "/admin/codes", permanent: false },
    ];
  },
};

export default nextConfig;
