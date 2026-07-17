import { headers } from "next/headers";import Link from "next/link";import AnalyticsClient from "./AnalyticsClient";
export default async function ReviewAnalyticsPage(){const h=await headers();const shop=h.get("x-shopify-shop-domain")||"";return <main style={{padding:24,maxWidth:1200,margin:"auto"}}><p><Link href="/admin/reviews">← Reviews</Link></p><AnalyticsClient shop={shop}/></main>}
