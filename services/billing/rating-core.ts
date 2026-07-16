import { Prisma } from "../../generated/prisma/index.js";

export type FeatureRatingInput = {
  usedQuantity: Prisma.Decimal.Value;
  includedQuantity: Prisma.Decimal.Value;
  unitRate: Prisma.Decimal.Value;
};

/**
 * The commercial allowance/overage calculation shared by final rating and
 * read-only live estimates. Values remain Decimal values until transport
 * serialization so neither path can introduce floating-point rounding.
 */
export function calculateFeatureRating(input: FeatureRatingInput) {
  const usedQuantity = new Prisma.Decimal(input.usedQuantity);
  const includedQuantity = new Prisma.Decimal(input.includedQuantity);
  const unitRate = new Prisma.Decimal(input.unitRate);
  const billableQuantity = Prisma.Decimal.max(usedQuantity.minus(includedQuantity), new Prisma.Decimal(0));
  return { usedQuantity, includedQuantity, billableQuantity, amount: billableQuantity.times(unitRate) };
}
