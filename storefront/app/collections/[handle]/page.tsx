import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { findRedirect, getCollection, listCollectionHandles } from "@/lib/catalog/queries.ts";
import { ProductCard } from "@/components/product-card.tsx";

export async function generateStaticParams() {
  // Cache Components needs at least one param; fall back to a placeholder when
  // the database is not reachable at build time (e.g. a preview without secrets).
  const handles = await listCollectionHandles().catch(() => []);
  return handles.length ? handles.map((handle) => ({ handle })) : [{ handle: "__placeholder__" }];
}

export async function generateMetadata({ params }: PageProps<"/collections/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const collection = await getCollection(handle);
  if (!collection) return {};
  return {
    title: collection.seoTitle ?? collection.title,
    description: collection.seoDescription ?? undefined,
    alternates: { canonical: `/collections/${collection.handle}` },
  };
}

export default async function CollectionPage({ params }: PageProps<"/collections/[handle]">) {
  const { handle } = await params;
  const collection = await getCollection(handle);
  if (!collection) {
    const target = await findRedirect(`/collections/${handle}`);
    if (target) permanentRedirect(target);
    notFound();
  }

  return (
    <>
      <h1>{collection.title}</h1>
      <div className="muted">{collection.products.length} products</div>
      {collection.descriptionHtml && (
        <div className="description" dangerouslySetInnerHTML={{ __html: collection.descriptionHtml }} />
      )}
      <div className="grid">
        {collection.products.map((p, i) => (
          <ProductCard key={p.handle} product={p} eager={i < 4} />
        ))}
      </div>
    </>
  );
}
