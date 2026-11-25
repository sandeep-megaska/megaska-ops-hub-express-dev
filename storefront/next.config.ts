import type { NextConfig } from "next";

const indexable = process.env.SITE_INDEXABLE === "true";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // This app lives inside the ops-hub repository. Keep Turbopack from picking
  // up the parent project's lockfile and PostCSS/Tailwind setup.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  async headers() {
    // Until the domain cutover, nothing on this deployment may be indexed:
    // it would compete with megaska.com as duplicate content.
    if (indexable) return [];
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default nextConfig;
