import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // a second build folder lets the online version be tested next to the local one (see README)
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
