import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // noVNC ships untranspiled ESM — let Next compile it for the browser bundle.
  transpilePackages: ["@novnc/novnc"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.discordapp.com" },
    ],
  },
};

export default nextConfig;
