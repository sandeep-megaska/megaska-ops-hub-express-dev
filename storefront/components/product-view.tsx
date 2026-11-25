"use client";

import { useEffect, useMemo, useState } from "react";
import type { Media, Product, Variant } from "@/lib/catalog/queries.ts";
import { shopifyImageUrl, shopifySrcSet } from "@/lib/format.ts";
import { Price } from "./price.tsx";

const LIVE_STORE = process.env.NEXT_PUBLIC_LIVE_STORE_URL ?? "https://megaska.com";

type Selection = string[]; // one value per option, aligned with product.options

function pick(variants: Variant[], selected: Selection): Variant | undefined {
  return variants.find((v) => v.optionValues.every((value, i) => value === selected[i]));
}

/**
 * Megaska tags each image's alt text with its colour ("Black", "Wine"), so
 * when a colour is chosen we show that colour's images first.
 */
function galleryFor(product: Product, selected: Selection, variant?: Variant): Media[] {
  const colourIndex = product.options.findIndex((o) => /^colou?r$/i.test(o.name));
  const colour = colourIndex >= 0 ? selected[colourIndex] : undefined;
  if (colour) {
    const matching = product.media.filter((m) => m.alt?.trim().toLowerCase() === colour.toLowerCase());
    if (matching.length) return matching;
  }
  if (variant?.imageUrl) {
    const first = product.media.find((m) => m.url === variant.imageUrl);
    if (first) return [first, ...product.media.filter((m) => m !== first)];
  }
  return product.media;
}

export function ProductView({ product }: { product: Product }) {
  const { options, variants } = product;
  const initial = variants.find((v) => v.available) ?? variants[0];
  const [selected, setSelected] = useState<Selection>(() => initial?.optionValues ?? []);

  // ?variant=<SKU> links select that variant.
  useEffect(() => {
    const sku = new URLSearchParams(window.location.search).get("variant");
    const fromUrl = sku ? variants.find((v) => v.sku?.toLowerCase() === sku.toLowerCase()) : undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the URL after hydration
    if (fromUrl) setSelected(fromUrl.optionValues);
  }, [variants]);

  const variant = pick(variants, selected);
  const gallery = useMemo(() => galleryFor(product, selected, variant), [product, selected, variant]);

  function choose(index: number, value: string) {
    let next = selected.map((v, i) => (i === index ? value : v));
    // That combination may not exist: keep the new choice, fill the rest from a variant that has it.
    if (!pick(variants, next)) {
      const fallback =
        variants.find((v) => v.available && v.optionValues[index] === value) ??
        variants.find((v) => v.optionValues[index] === value);
      if (fallback) next = fallback.optionValues;
    }
    setSelected(next);
    const chosen = pick(variants, next);
    if (chosen?.sku) {
      const url = new URL(window.location.href);
      url.searchParams.set("variant", chosen.sku);
      window.history.replaceState(null, "", url);
    }
  }

  /** Is `value` available given the other current choices? */
  function valueAvailable(index: number, value: string): boolean {
    return variants.some(
      (v) => v.available && v.optionValues.every((ov, i) => (i === index ? ov === value : ov === selected[i])),
    );
  }

  return (
    <div className="pdp">
      <div className="gallery">
        {gallery.map((m, i) => (
          <img
            key={m.url}
            src={shopifyImageUrl(m.url, 1080)}
            srcSet={shopifySrcSet(m.url, [540, 720, 1080, 1440])}
            sizes="(min-width: 900px) 30vw, 85vw"
            alt={m.alt ?? product.title}
            width={1080}
            height={1440}
            loading={i < 2 ? "eager" : "lazy"}
            fetchPriority={i === 0 ? "high" : undefined}
          />
        ))}
      </div>

      <div>
        <h1>{product.title}</h1>
        <Price price={variant?.price ?? null} compareAt={variant?.compareAtPrice ?? null} />
        <div className="note">Inclusive of all taxes</div>

        {options.map((option, index) => (
          <div className="option" key={option.name}>
            <div className="option-name">
              {option.name}: <span className="muted">{selected[index]}</span>
            </div>
            <div className="swatches" role="group" aria-label={option.name}>
              {option.values.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`swatch${valueAvailable(index, value) ? "" : " unavailable"}`}
                  aria-pressed={selected[index] === value}
                  onClick={() => choose(index, value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ))}

        {variant?.available ? (
          <a className="buy" href={`${LIVE_STORE}/products/${product.handle}`} rel="nofollow">
            Buy on megaska.com
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
