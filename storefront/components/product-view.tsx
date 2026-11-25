"use client";

import { useEffect, useMemo, useState } from "react";
import type { Media, Product, Variant } from "@/lib/catalog/queries.ts";
import { shopifyImageUrl, shopifySrcSet } from "@/lib/format.ts";
import { Price } from "./price.tsx";

const LIVE_STORE = process.env.NEXT_PUBLIC_LIVE_STORE_URL ?? "https://megaska.com";

/** Options Shopify adds when a product has no real options. */
const isPlaceholderOption = (o: { name: string; values: string[] }) =>
  o.name === "Title" && o.values.length === 1 && o.values[0] === "Default Title";

function pickVariant(variants: Variant[], selected: Record<string, string>): Variant | undefined {
  return variants.find((v) => v.selectedOptions.every((o) => selected[o.name] === o.value));
}

function optionsOf(v: Variant): Record<string, string> {
  return Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value]));
}

/**
 * Megaska tags each image's alt text with its colour ("Black", "Wine"), so
 * when a colour is chosen we show that colour's images first.
 */
function galleryFor(media: Media[], selected: Record<string, string>, variant?: Variant): Media[] {
  const colour = selected["Color"] ?? selected["Colour"];
  if (colour) {
    const matching = media.filter((m) => m.alt?.trim().toLowerCase() === colour.toLowerCase());
    if (matching.length) return matching;
  }
  if (variant?.imageId) {
    const first = media.find((m) => m.id === variant.imageId);
    if (first) return [first, ...media.filter((m) => m !== first)];
  }
  return media;
}

export function ProductView({ product }: { product: Product }) {
  const options = product.options.filter((o) => !isPlaceholderOption(o));
  const initial = product.variants.find((v) => v.available) ?? product.variants[0];
  const [selected, setSelected] = useState<Record<string, string>>(() => (initial ? optionsOf(initial) : {}));

  // Honour ?variant=<id> links (Shopify uses the same parameter).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("variant");
    const fromUrl = id ? product.variants.find((v) => v.id === id) : undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the URL after hydration
    if (fromUrl) setSelected(optionsOf(fromUrl));
  }, [product.variants]);

  const variant = pickVariant(product.variants, selected);
  const gallery = useMemo(() => galleryFor(product.media, selected, variant), [product.media, selected, variant]);

  function choose(name: string, value: string) {
    const next = { ...selected, [name]: value };
    // If that combination does not exist, keep the new choice and fill the rest from a variant that has it.
    if (!pickVariant(product.variants, next)) {
      const fallback =
        product.variants.find((v) => v.available && v.selectedOptions.some((o) => o.name === name && o.value === value)) ??
        product.variants.find((v) => v.selectedOptions.some((o) => o.name === name && o.value === value));
      if (fallback) Object.assign(next, optionsOf(fallback));
    }
    setSelected(next);
    const chosen = pickVariant(product.variants, next);
    if (chosen) {
      const url = new URL(window.location.href);
      url.searchParams.set("variant", chosen.id);
      window.history.replaceState(null, "", url);
    }
  }

  /** Is `value` available given the other current choices? */
  function valueAvailable(name: string, value: string): boolean {
    return product.variants.some(
      (v) =>
        v.available &&
        v.selectedOptions.every((o) => (o.name === name ? o.value === value : selected[o.name] === o.value)),
    );
  }

  return (
    <div className="pdp">
      <div className="gallery">
        {gallery.map((m, i) => (
          <img
            key={m.id}
            src={shopifyImageUrl(m.url, 1080)}
            srcSet={shopifySrcSet(m.url, [540, 720, 1080, 1440])}
            sizes="(min-width: 900px) 30vw, 85vw"
            alt={m.alt ?? product.title}
            width={m.width ?? undefined}
            height={m.height ?? undefined}
            loading={i < 2 ? "eager" : "lazy"}
            fetchPriority={i === 0 ? "high" : undefined}
          />
        ))}
      </div>

      <div>
        <h1>{product.title}</h1>
        <Price price={variant?.price ?? null} compareAt={variant?.compareAtPrice ?? null} />
        <div className="note">Inclusive of all taxes</div>

        {options.map((option) => (
          <div className="option" key={option.name}>
            <div className="option-name">
              {option.name}: <span className="muted">{selected[option.name]}</span>
            </div>
            <div className="swatches" role="group" aria-label={option.name}>
              {option.values.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`swatch${valueAvailable(option.name, value) ? "" : " unavailable"}`}
                  aria-pressed={selected[option.name] === value}
                  onClick={() => choose(option.name, value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ))}

        {variant?.available ? (
          <a className="buy" href={`${LIVE_STORE}/cart/${variant.id}:1`} rel="nofollow">
            Buy now on megaska.com
          </a>
        ) : (
          <span className="buy" aria-disabled="true">{variant ? "Sold out" : "Unavailable"}</span>
        )}
        <div className="note">
          Test storefront: checkout still runs on megaska.com. Our own checkout arrives in Phase 2.
          {variant?.sku && <> · SKU {variant.sku}</>}
        </div>

        {product.descriptionHtml && (
          <div className="description" dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
        )}
      </div>
    </div>
  );
}
