// Admin GraphQL documents for the catalog sync, written against API 2026-10.
// Each was validated against the live Megaska store. Keep requested query
// cost under 1000 (Shopify's per-query maximum) when adding fields.

const VARIANT_FIELDS = /* GraphQL */ `
  id title sku price compareAtPrice position taxable inventoryPolicy inventoryQuantity
  selectedOptions { name value }
  media(first: 1) { nodes { id } }
  inventoryItem { id tracked harmonizedSystemCode }
`;

export const PRODUCT_QUERY = /* GraphQL */ `
  query StorefrontSyncProduct($id: ID!) {
    product(id: $id) {
      id handle title descriptionHtml productType vendor status tags
      publishedAt createdAt updatedAt templateSuffix
      seo { title description }
      options { name position values }
      metafields(first: 30) { nodes { namespace key type value } }
      media(first: 50) {
        nodes {
          id mediaContentType alt
          ... on MediaImage { image { url width height altText } }
          preview { image { url width height } }
        }
      }
      variants(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { ${VARIANT_FIELDS} }
      }
      collections(first: 50) { nodes { id } }
    }
  }
`;

export const PRODUCT_VARIANTS_PAGE_QUERY = /* GraphQL */ `
  query StorefrontSyncProductVariants($id: ID!, $after: String) {
    product(id: $id) {
      variants(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${VARIANT_FIELDS} }
      }
    }
  }
`;

export const PRODUCT_IDS_QUERY = /* GraphQL */ `
  query StorefrontSyncProductIds($after: String) {
    products(first: 250, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes { id }
    }
  }
`;

const COLLECTION_FIELDS = /* GraphQL */ `
  id handle title descriptionHtml updatedAt sortOrder templateSuffix
  seo { title description }
  image { url altText width height }
  metafields(first: 30) { nodes { namespace key type value } }
`;

export const COLLECTION_QUERY = /* GraphQL */ `
  query StorefrontSyncCollection($id: ID!) {
    collection(id: $id) { ${COLLECTION_FIELDS} }
  }
`;

export const COLLECTIONS_PAGE_QUERY = /* GraphQL */ `
  query StorefrontSyncCollections($after: String) {
    collections(first: 50, after: $after, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes { ${COLLECTION_FIELDS} }
    }
  }
`;

/** Products in the collection's own sort order (manual, best selling, ...). */
export const COLLECTION_PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query StorefrontSyncCollectionProducts($id: ID!, $after: String) {
    collection(id: $id) {
      products(first: 250, after: $after, sortKey: COLLECTION_DEFAULT) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  }
`;

export const INVENTORY_ITEM_QUERY = /* GraphQL */ `
  query StorefrontSyncInventoryItem($id: ID!) {
    inventoryItem(id: $id) {
      id tracked
      variants(first: 10) { nodes { id inventoryQuantity product { id } } }
    }
  }
`;

export const URL_REDIRECTS_PAGE_QUERY = /* GraphQL */ `
  query StorefrontSyncRedirects($after: String) {
    urlRedirects(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id path target }
    }
  }
`;

export const WEBHOOK_SUBSCRIPTIONS_QUERY = /* GraphQL */ `
  query StorefrontWebhookSubscriptions($after: String) {
    webhookSubscriptions(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id topic uri }
    }
  }
`;

export const WEBHOOK_SUBSCRIPTION_CREATE = /* GraphQL */ `
  mutation StorefrontWebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $uri: String!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }
`;
