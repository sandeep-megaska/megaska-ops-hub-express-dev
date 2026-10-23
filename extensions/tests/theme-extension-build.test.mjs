import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// The theme extension deploys extensions/megaska-otp/assets/, built (minified) from
// the readable sources in extensions/megaska-otp-src/. These keep the two in step.
const root = new URL("../../", import.meta.url);
const assetDir = new URL("extensions/megaska-otp/assets/", root);

test("deployed assets are an up-to-date build of extensions/megaska-otp-src", () => {
  assert.doesNotThrow(
    () => execFileSync(process.execPath, ["scripts/build-theme-extension.mjs", "--check"], { cwd: root, stdio: "pipe" }),
    "run `npm run build:extension` after editing extensions/megaska-otp-src",
  );
});

test("every built script parses as a browser script", () => {
  const scripts = fs.readdirSync(assetDir).filter((name) => name.endsWith(".js"));
  assert.ok(scripts.length > 0);
  for (const name of scripts) {
    const code = fs.readFileSync(new URL(name, assetDir), "utf8");
    assert.doesNotThrow(() => new vm.Script(code, { filename: name }), name);
  }
});
