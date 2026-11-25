import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Minified build output; lint the sources in extensions/megaska-otp-src instead.
    "extensions/megaska-otp/assets/**",
    // Separate Next.js app with its own lint/typecheck (deployed as its own Vercel project).
    "storefront/**",
  ]),
]);

export default eslintConfig;
