import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // noVNC ships untranspiled ESM — let Next compile it for the browser bundle.
  transpilePackages: ["@novnc/novnc"],
  // The BFF proxies the container deploy zip upload (default proxy cap is 10MB).
  experimental: {
    proxyClientMaxBodySize: "60mb",
  },
  // Security headers on the HTML documents (the Rust middleware only covers the
  // API). Anti-clickjacking + referrer + nosniff; no restrictive CSP that would
  // break the app's inline scripts/styles.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.discordapp.com" },
    ],
  },
};

export default nextConfig;
