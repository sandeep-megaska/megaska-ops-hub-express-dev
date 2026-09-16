import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // puppeteer-core and @sparticuz/chromium must NOT be bundled by the server
  // compiler — @sparticuz/chromium resolves its packed Chromium binary relative
  // to its own package dir, which bundling destroys. Only the document PDF route
  // pulls them in, and lazily.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  async headers() {
    return [
      {
        // The practitioner console holds patient data. Keep it out of indexes
        // and out of other people's frames.
        source: "/console/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // The embed loader is meant to be fetched cross-origin by tenant sites.
        source: "/api/embed/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
    ];
  },
};

export default nextConfig;
