import test from "node:test";
import assert from "node:assert/strict";
import { ShopifyFileUploadError, uploadImageToShopifyFiles } from "./file-upload.ts";

const png = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), filename: "my logo.png", mimeType: "image/png" };

function fakeShopify(opts: { imageReadyAfter?: number; failed?: boolean } = {}) {
  const calls: string[] = [];
  let polls = 0;
  const graphql = async <T,>(query: string, variables: Record<string, unknown>): Promise<T> => {
    if (query.includes("stagedUploadsCreate")) {
      calls.push("staged:" + JSON.stringify(variables));
      return { stagedUploadsCreate: { stagedTargets: [{ url: "https://storage.example/upload", resourceUrl: "https://storage.example/tmp/logo.png", parameters: [{ name: "key", value: "tmp/logo.png" }] }], userErrors: [] } } as T;
    }
    if (query.includes("fileCreate")) {
      calls.push("create:" + JSON.stringify(variables));
      return { fileCreate: { files: [{ id: "gid://shopify/MediaImage/1", fileStatus: "UPLOADED", image: null }], userErrors: [] } } as T;
    }
    polls += 1;
    if (opts.failed) return { node: { fileStatus: "FAILED", image: null } } as T;
    return { node: polls >= (opts.imageReadyAfter ?? 1) ? { fileStatus: "READY", image: { url: "https://cdn.shopify.com/s/files/1/0001/files/my-logo.png" } } : { fileStatus: "PROCESSING", image: null } } as T;
  };
  const uploads: FormData[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => { uploads.push(init?.body as FormData); return new Response(null, { status: 201 }); }) as typeof fetch;
  return { calls, uploads, deps: { graphql, fetchImpl, sleep: async () => {}, pollAttempts: 5 } };
}

test("uploads to Shopify Files and returns the CDN URL once processed", async () => {
  const shopify = fakeShopify({ imageReadyAfter: 2 });
  const url = await uploadImageToShopifyFiles("acme.myshopify.com", png, shopify.deps);
  assert.equal(url, "https://cdn.shopify.com/s/files/1/0001/files/my-logo.png");
  assert.match(shopify.calls[0], /"resource":"IMAGE".*"filename":"my-logo.png".*"fileSize":"7"/);
  assert.match(shopify.calls[1], /"originalSource":"https:\/\/storage.example\/tmp\/logo.png".*"contentType":"IMAGE"/);
  const form = shopify.uploads[0];
  assert.equal(form.get("key"), "tmp/logo.png");
  assert.ok(form.get("file") instanceof Blob);
});

test("rejects unsupported, empty or oversized files before calling Shopify", async () => {
  const shopify = fakeShopify();
  await assert.rejects(uploadImageToShopifyFiles("acme.myshopify.com", { ...png, mimeType: "image/svg+xml" }, shopify.deps), (e: unknown) => e instanceof ShopifyFileUploadError && e.code === "UNSUPPORTED_TYPE");
  await assert.rejects(uploadImageToShopifyFiles("acme.myshopify.com", { ...png, bytes: new Uint8Array() }, shopify.deps), /empty/);
  await assert.rejects(uploadImageToShopifyFiles("acme.myshopify.com", { ...png, bytes: new Uint8Array(2 * 1024 * 1024 + 1) }, shopify.deps), /2 MB/);
  assert.equal(shopify.calls.length, 0);
});

test("reports a processing failure from Shopify", async () => {
  await assert.rejects(uploadImageToShopifyFiles("acme.myshopify.com", png, fakeShopify({ failed: true }).deps), (e: unknown) => e instanceof ShopifyFileUploadError && e.code === "PROCESSING_FAILED");
});
