import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs; the FlatCompat shim from
// older setups fails against them.
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      "generated/**",
      ".next/**",
      "node_modules/**",
    ],
  },
];

export default eslintConfig;
