import type { Metadata } from "next";
import { Homepage } from "@/components/homepage";
import { homepageConfig } from "@/config/homepage";

export const metadata: Metadata = {
  title: homepageConfig.site.title,
  description: homepageConfig.site.description,
  alternates: { canonical: homepageConfig.site.url },
  openGraph: {
    title: homepageConfig.site.title,
    description: homepageConfig.site.description,
    url: homepageConfig.site.url,
    siteName: homepageConfig.site.name,
    type: "website",
  },
};

export default function HomePage() {
  return <Homepage />;
}
