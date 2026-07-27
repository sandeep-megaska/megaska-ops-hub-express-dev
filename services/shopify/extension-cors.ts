import { NextResponse } from "next/server";

const EXTENSION_ORIGIN = "https://extensions.shopifycdn.com";

/**
 * Admin UI Extensions run in a sandboxed iframe on extensions.shopifycdn.com.
 * fetch() calls back to our own app backend need this origin allowed explicitly.
 */
export function withExtensionCors(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", EXTENSION_ORIGIN);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return response;
}

export function extensionCorsPreflight(): NextResponse {
  return withExtensionCors(new NextResponse(null, { status: 204 }));
}
