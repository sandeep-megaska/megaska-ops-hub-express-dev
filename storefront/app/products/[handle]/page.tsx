import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { findRedirect, getProduct, listProductHandles } from "@/lib/catalog/queries.ts";
import { ProductView } from "@/components/product-view.tsx";
import { shopifyImageUrl } from "@/lib/format.ts";

export async function generateStaticParams() {
  const handles = await listProductHandles().catch(() => []);
  return handles.length ? handles.map((handle) => ({ handle })) : [{ handle: "__placeholder__" }];
}

export async function generateMetadata({ params }: PageProps<"/products/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const product = await getProduct(handle);
  if (!product) return {};
  const image = product.media[0];
  return {
    title: product.seoTitle ?? product.title,
    description: product.seoDescription ?? undefined,
    alternates: { canonical: `/products/${product.handle}` },
    openGraph: image ? { images: [{ url: shopifyImageUrl(image.url, 1200), alt: image.alt ?? product.title }] } : undefined,
  };
}

export default async function ProductPage({ params }: PageProps<"/products/[handle]">) {
  const { handle } = await params;
  const product = await getProduct(handle);
  if (!product) {
    const target = await findRedirect(`/products/${handle}`);
    if (target) permanentRedirect(target);
    notFound();
  }

  // Product structured data, as Shopify themes emit, so rich results carry over.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    name: product.title,
    productGroupID: product.shopifyId,
    brand: { "@type": "Brand", name: product.vendor || "Megaska" },
    description: product.seoDescription ?? undefined,
    image: product.media.slice(0, 5).map((m) => shopifyImageUrl(m.url, 1080)),
    hasVariant: product.variants.map((v) => ({
      "@type": "Product",
      sku: v.sku ?? undefined,
      name: `${product.title} - ${v.title}`,
      offers: {
        "@type": "Offer",
        price: v.price,
        priceCurrency: "INR",
        availability: v.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        url: `/products/${product.handle}?variant=${v.id}`,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <ProductView product={product} />
    </>
  );
}
