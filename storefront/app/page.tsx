import Link from "next/link";
import { listCollections } from "@/lib/catalog/queries.ts";
import { shopifyImageUrl } from "@/lib/format.ts";

export default async function Home() {
  const collections = await listCollections();
  return (
    <>
      <h1>Shop by collection</h1>
      {collections.length === 0 ? (
        <p className="muted">No products yet. Run the first catalog sync (see storefront/README.md).</p>
      ) : (
        <div className="collections">
          {collections.map((c, i) => (
            <Link key={c.handle} href={`/collections/${c.handle}`} className="collection-tile">
              <div className="card-img">
                {c.image && (
                  <img
                    src={shopifyImageUrl(c.image.url, 540)}
                    alt={c.image.alt ?? c.title}
                    loading={i < 4 ? "eager" : "lazy"}
                  />
                )}
              </div>
              <div className="card-title">{c.title}</div>
              <div className="muted" style={{ fontSize: 13 }}>{c.productCount} products</div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
