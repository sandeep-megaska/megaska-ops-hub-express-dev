import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
