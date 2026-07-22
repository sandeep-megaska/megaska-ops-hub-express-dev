import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../megaska-otp/assets/megaska-otp.js", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} should be present before ${nextName}`);
  return source.slice(start, end);
}

test("theme account SVG cloning is scoped and sanitized", () => {
  const discovery = functionSource("findThemeAccountSvg", "readSvgPresentation");
  const sanitization = functionSource("sanitizeThemeAccountSvg", "findThemeAccountSvg");
  assert.match(discovery, /closest\("header"\)/);
  assert.match(discovery, /ACCOUNT_TRIGGER_SELECTORS/);
  assert.match(discovery, /closest\("\[data-megaska-fallback-account\]"\)/);
  assert.match(sanitization, /cloneNode\(true\)/);
  assert.match(sanitization, /removeAttribute\("id"\)/);
  assert.match(sanitization, /script, style, animate/);
  assert.match(sanitization, /aria-hidden", "true"/);
  assert.match(sanitization, /focusable", "false"/);
});

test("reference inference supports constrained stroke and fill glyphs", () => {
  const inference = functionSource("readSvgPresentation", "findReferenceSvg");
  const rendering = functionSource("createInferredAccountSvg", "adaptDesktopAccountFallback");
  assert.match(inference, /strokeActive \? "stroke" : fillActive \? "fill"/);
  assert.match(inference, /1\.25, 2\.25, 1\.7/);
  assert.match(rendering, /presentation\.mode === "fill"/);
  assert.match(rendering, /fill", "currentColor"/);
  assert.match(rendering, /stroke", "currentColor"/);
  assert.match(rendering, /viewBox", "0 0 24 24"/);
});

test("adaptation falls back safely and is idempotent", () => {
  const adaptation = functionSource("adaptDesktopAccountFallback", "createMobileAccountFallback");
  assert.match(adaptation, /"loopdesk-default"/);
  assert.match(adaptation, /dataset\.loopdeskAccountIconSignature === signature/);
  assert.match(adaptation, /data-loopdesk-account-icon-source/);
  assert.match(adaptation, /--loopdesk-account-control-size/);
  assert.match(source, /search: \[/);
  assert.match(source, /cart: \[/);
  assert.match(adaptation, /`reference-\$\{reference\.kind\}`/);
});
