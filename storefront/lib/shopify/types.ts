// Shapes returned by the queries in ./queries.ts.

export type Connection<T> = {
  nodes: T[];
  pageInfo?: { hasNextPage: boolean; endCursor: string | null };
};

export type ShopifyMetafield = { namespace: string; key: string; type: string; value: string };

export type ShopifyImage = { url: string; width: number | null; height: number | null; altText?: string | null };

export type ShopifyMedia = {
  id: string;
  mediaContentType: string;
  alt: string | null;
  image?: ShopifyImage | null;
  preview?: { image: ShopifyImage | null } | null;
};

export type ShopifyVariant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  position: number;
  taxable: boolean;
  inventoryPolicy: string;
  inventoryQuantity: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
  media: Connection<{ id: string }>;
  inventoryItem: { id: string; tracked: boolean; harmonizedSystemCode: string | null } | null;
};

export type ShopifyProduct = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  status: string;
  tags: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  templateSuffix: string | null;
  seo: { title: string | null; description: string | null };
  options: Array<{ name: string; position: number; values: string[] }>;
  metafields: Connection<ShopifyMetafield>;
  media: Connection<ShopifyMedia>;
  variants: Connection<ShopifyVariant>;
  collections: Connection<{ id: string }>;
};

export type ShopifyCollection = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  updatedAt: string;
  sortOrder: string;
  templateSuffix: string | null;
  seo: { title: string | null; description: string | null };
  image: ShopifyImage | null;
  metafields: Connection<ShopifyMetafield>;
};
