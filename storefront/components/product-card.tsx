import Link from "next/link";
import type { ProductCard as Card } from "@/lib/catalog/queries.ts";
import { shopifyImageUrl, shopifySrcSet } from "@/lib/format.ts";
import { Price } from "./price.tsx";

const SIZES = "(min-width: 760px) 25vw, 50vw";

export function ProductCard({ product, eager = false }: { product: Card; eager?: boolean }) {
  const [first, second] = product.images;
  return (
    <Link href={`/products/${product.handle}`} className="card">
      <div className="card-img">
        {first && (
          <img
            src={shopifyImageUrl(first.url, 540)}
            srcSet={shopifySrcSet(first.url)}
            sizes={SIZES}
            alt={first.alt ?? product.title}
            width={first.width ?? undefined}
            height={first.height ?? undefined}
            loading={eager ? "eager" : "lazy"}
          />
        )}
        {second && (
          <img
            className="alt"
            src={shopifyImageUrl(second.url, 540)}
            srcSet={shopifySrcSet(second.url)}
            sizes={SIZES}
            alt=""
            loading="lazy"
          />
        )}
        {!product.available && <span className="badge">Sold out</span>}
      </div>
      <div className="card-title">{product.title}</div>
      <Price price={product.minPrice} compareAt={product.compareAtPrice} />
    </Link>
  );
}
