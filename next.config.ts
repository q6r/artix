import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // noVNC ships untranspiled ESM — let Next compile it for the browser bundle.
  transpilePackages: ["@novnc/novnc"],
  // The BFF proxies the container deploy zip upload (default proxy cap is 10MB).
  experimental: {
    proxyClientMaxBodySize: "60mb",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.discordapp.com" },
    ],
  },
};

export default nextConfig;
