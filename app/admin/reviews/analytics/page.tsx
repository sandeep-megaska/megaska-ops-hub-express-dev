import { headers } from "next/headers";import Link from "next/link";import AnalyticsClient from "./AnalyticsClient";
export default async function ReviewAnalyticsPage(){const h=await headers();const shop=h.get("x-shopify-shop-domain")||"";return <main className="mk-main"><p><Link href="/admin/reviews" className="mk-link">← Reviews</Link></p><AnalyticsClient shop={shop}/></main>}
