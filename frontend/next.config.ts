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
  // next@16.3's build-time type check now defaults to running the project's
  // own `tsc` CLI (experimental.useTypeScriptCli), which type-checks every
  // file matched by tsconfig's `include` — unlike the previous checker, it
  // does not skip *.test.ts(x)/__tests__ files. Point production builds at
  // a narrower tsconfig so shipped app code is still fully type-checked
  // without requiring test files to type-check cleanly for `next build`.
  typescript: {
    tsconfigPath: "tsconfig.build.json",
  },
};

export default nextConfig;
