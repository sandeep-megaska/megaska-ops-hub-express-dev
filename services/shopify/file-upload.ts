// Uploads an image to the store's own Shopify Files and returns its cdn.shopify.com URL.
// Runs on the server: the admin page sends the file to LoopD2C, and only the server talks
// to Shopify's staged-upload storage, so admin pages make no requests to other hosts
// (network access rules). Needs the write_files scope.
import { adminGraphql } from "./admin";

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export class ShopifyFileUploadError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ShopifyFileUploadError";
  }
}

type Graphql = <T>(query: string, variables: Record<string, unknown>, options: { shopDomain: string; preferStoredToken: boolean }) => Promise<T>;
type Deps = { graphql?: Graphql; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; pollAttempts?: number };

type UserError = { field?: string[] | null; message: string };

const STAGED_UPLOAD = `mutation LoopD2CStagedUpload($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } }
}`;
const FILE_CREATE = `mutation LoopD2CFileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) { files { id fileStatus ... on MediaImage { image { url } } } userErrors { field message } }
}`;
const FILE_STATUS = `query LoopD2CFileStatus($id: ID!) {
  node(id: $id) { ... on MediaImage { fileStatus image { url } } }
}`;

function firstError(errors: UserError[] | undefined) {
  return errors && errors.length ? errors.map((e) => e.message).join("; ") : null;
}

export async function uploadImageToShopifyFiles(
  shopDomain: string,
  file: { bytes: Uint8Array; filename: string; mimeType: string; alt?: string },
  deps: Deps = {},
): Promise<string> {
  const graphql: Graphql = deps.graphql ?? ((query, variables, options) => adminGraphql(query, variables, options));
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const options = { shopDomain, preferStoredToken: true };

  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.mimeType)) throw new ShopifyFileUploadError("UNSUPPORTED_TYPE", "Upload a PNG, JPG, WebP or GIF image.");
  if (!file.bytes.byteLength) throw new ShopifyFileUploadError("EMPTY_FILE", "The file is empty.");
  if (file.bytes.byteLength > LOGO_MAX_BYTES) throw new ShopifyFileUploadError("TOO_LARGE", "The image must be 2 MB or smaller.");
  const filename = file.filename.replace(/[^\w.-]+/g, "-").slice(-80) || "logo";

  // 1. Ask Shopify where to put the file.
  const staged = await graphql<{ stagedUploadsCreate: { stagedTargets: Array<{ url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }>; userErrors: UserError[] } }>(
    STAGED_UPLOAD,
    { input: [{ resource: "IMAGE", filename, mimeType: file.mimeType, httpMethod: "POST", fileSize: String(file.bytes.byteLength) }] },
    options,
  );
  const stagedError = firstError(staged.stagedUploadsCreate.userErrors);
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (stagedError || !target) throw new ShopifyFileUploadError("STAGED_UPLOAD_FAILED", stagedError || "Shopify returned no upload target.");

  // 2. Send the bytes to Shopify's storage (form fields first, file last).
  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  const blob = new Blob([new Uint8Array(file.bytes)], { type: file.mimeType });
  form.append("file", blob, filename);
  const uploaded = await doFetch(target.url, { method: "POST", body: form });
  if (!uploaded.ok) throw new ShopifyFileUploadError("STORAGE_UPLOAD_FAILED", `Upload to Shopify storage failed (HTTP ${uploaded.status}).`);

  // 3. Turn the upload into a file in Shopify Files.
  const created = await graphql<{ fileCreate: { files: Array<{ id: string; fileStatus: string; image?: { url?: string | null } | null }>; userErrors: UserError[] } }>(
    FILE_CREATE,
    { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: (file.alt || "Logo").slice(0, 120) }] },
    options,
  );
  const createError = firstError(created.fileCreate.userErrors);
  const record = created.fileCreate.files[0];
  if (createError || !record) throw new ShopifyFileUploadError("FILE_CREATE_FAILED", createError || "Shopify didn't create the file.");
  if (record.image?.url) return record.image.url;

  // 4. Shopify processes images asynchronously; wait briefly for the CDN URL.
  for (let attempt = 0; attempt < (deps.pollAttempts ?? 10); attempt += 1) {
    await sleep(800);
    const status = await graphql<{ node: { fileStatus?: string; image?: { url?: string | null } | null } | null }>(FILE_STATUS, { id: record.id }, options);
    if (status.node?.image?.url) return status.node.image.url;
    if (status.node?.fileStatus === "FAILED") throw new ShopifyFileUploadError("PROCESSING_FAILED", "Shopify couldn't process this image. Try another file.");
  }
  throw new ShopifyFileUploadError("PROCESSING_TIMEOUT", "Shopify is still processing the image. Wait a moment and upload again.");
}
