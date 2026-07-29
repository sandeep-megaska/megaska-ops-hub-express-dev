import type { MetadataRoute } from "next";

// app.loopd2c.com (and its Vercel deployments) is the LoopD2C Shopify app
// backend + OAuth surface — an embedded admin app, not a public website. It has
// no content meant to be crawled or indexed; the public marketing site lives on
// a separate domain (www.loopd2c.com). Disallowing crawlers here stops search
// engines and Safe Browsing from evaluating internal/OAuth pages as if they were
// a public site, which is what led to a false "deceptive site" classification.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
