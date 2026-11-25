import { discountPercent, formatPrice } from "@/lib/format.ts";

export function Price({ price, compareAt }: { price: string | null; compareAt: string | null }) {
  const off = discountPercent(price, compareAt);
  return (
    <div className="price">
      <span className="now">{formatPrice(price)}</span>
      {off !== null && (
        <>
          <span className="was">{formatPrice(compareAt)}</span>
          <span className="off">{off}% off</span>
        </>
      )}
    </div>
  );
}
