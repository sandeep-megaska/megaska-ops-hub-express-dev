export type ReviewSubmissionInput = {
  rating: number;
  title?: string | null;
  body: string;
  productId: string;
  variantId?: string | null;
  orderId: string;
  orderLineId: string;
};

export class ReviewSubmissionInputError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string>) {
    super("Invalid review submission input");
    this.name = "ReviewSubmissionInputError";
    this.fieldErrors = fieldErrors;
  }
}

const allowedFields = new Set(["rating", "title", "body", "productId", "variantId", "orderId", "orderLineId"]);

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function requiredId(input: Record<string, unknown>, field: keyof ReviewSubmissionInput, errors: Record<string, string>) {
  const value = text(input[field]);
  if (!value) errors[field] = "Required.";
  return value || "";
}

export function validateReviewSubmissionInput(raw: unknown): ReviewSubmissionInput {
  const errors: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ReviewSubmissionInputError({ input: "Expected an object." });
  const input = raw as Record<string, unknown>;
  for (const field of Object.keys(input)) if (!allowedFields.has(field)) errors[field] = "Unsupported field.";

  if (!Number.isInteger(input.rating) || (input.rating as number) < 1 || (input.rating as number) > 5) errors.rating = "Rating must be an integer from 1 to 5.";
  const title = input.title === undefined || input.title === null ? null : text(input.title);
  if (input.title !== undefined && input.title !== null && typeof input.title !== "string") errors.title = "Title must be a string.";
  if (title && title.length > 120) errors.title = "Title must be 120 characters or fewer.";
  const body = text(input.body);
  if (typeof input.body !== "string" || !body) errors.body = "Body is required.";
  else if (body.length < 5) errors.body = "Body must be at least 5 characters.";
  else if (body.length > 5000) errors.body = "Body must be 5000 characters or fewer.";

  const productId = requiredId(input, "productId", errors);
  const orderId = requiredId(input, "orderId", errors);
  const orderLineId = requiredId(input, "orderLineId", errors);
  const variantId = input.variantId === undefined || input.variantId === null ? null : text(input.variantId);
  if (input.variantId !== undefined && input.variantId !== null && typeof input.variantId !== "string") errors.variantId = "Variant ID must be a string.";

  if (Object.keys(errors).length) throw new ReviewSubmissionInputError(errors);
  return { rating: input.rating as number, title, body: body!, productId, variantId, orderId, orderLineId };
}
