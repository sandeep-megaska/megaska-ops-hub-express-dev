import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // puppeteer-core and @sparticuz/chromium must NOT be bundled by Next's server
  // compiler — @sparticuz/chromium resolves its packed Chromium binary relative to
  // its own package dir, which bundling destroys, and the attempt breaks the whole
  // route bundle. Externalizing them makes Next require() them from node_modules at
  // runtime instead. Only the GST invoice PDF route pulls them in, and lazily.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  async headers() {
    return [
      {
        // The app backend is not a public site. Keep every response out of
        // search indexes — reinforces robots.txt and shrinks the surface Safe
        // Browsing can misclassify (Googlebot bypasses the middleware redirect,
        // so it would otherwise index the raw admin/OAuth pages).
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
