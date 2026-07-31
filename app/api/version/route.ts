import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public build/version marker. Lets you positively confirm which deployment is
// serving a request — staging vs production, and the exact commit — from the
// browser console (reachable through the app proxy at /apps/loopd2c/api/version)
// or directly. It exposes only build metadata (commit / branch / env); no
// secrets. Vercel injects these env vars at build time.
export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || null;
  const branch = process.env.VERCEL_GIT_COMMIT_REF || null;
  // "production" | "preview" | "development" on Vercel; NODE_ENV otherwise.
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV || null;
  const region = process.env.VERCEL_REGION || null;

  const body = {
    ok: true,
    env,
    branch,
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    region,
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
      // Also surfaced as headers so it can be read off any HEAD/GET without
      // parsing the body (headers survive Shopify's app proxy).
      "x-app-env": String(env || ""),
      "x-app-commit": String(commit || ""),
      "x-app-branch": String(branch || ""),
    },
  });
}
