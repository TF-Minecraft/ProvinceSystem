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
  // Type-check shipped application code with the production build configuration.
  typescript: {
    tsconfigPath: "tsconfig.build.json",
  },
};

export default nextConfig;
