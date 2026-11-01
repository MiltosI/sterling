import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // exceljs relies on Node streams/fs; load it with plain require instead of bundling it
  serverExternalPackages: ["exceljs"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
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
