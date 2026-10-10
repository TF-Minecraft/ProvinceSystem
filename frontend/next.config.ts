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
  // Staff tools that moved into the staff panel.
  async redirects() {
    return [
      { source: "/precedent", destination: "/admin/precedent", permanent: false },
      { source: "/inspect", destination: "/admin/codes", permanent: false },
    ];
  },
};

export default nextConfig;
