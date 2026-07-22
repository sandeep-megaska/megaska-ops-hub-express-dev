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

class ElementFixture {
  constructor(tagName, attributes = {}, children = []) {
    this.tagName = tagName.toUpperCase();
    this.values = new Map(Object.entries(attributes));
    this.children = children;
    this.parentElement = null;
    children.forEach((child) => { child.parentElement = this; });
  }
  get attributes() { return [...this.values].map(([name, value]) => ({ name, value })); }
  get classList() { return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  getAttribute(name) { return this.values.get(name) ?? null; }
  setAttribute(name, value) { this.values.set(name, String(value)); }
  removeAttribute(name) { this.values.delete(name); }
  set id(value) { this.setAttribute("id", value); }
  set href(value) { this.setAttribute("href", value); }
  matches(selector) { return selector.split(",").some((part) => part.trim().toLowerCase() === this.tagName.toLowerCase()); }
  cloneNode(deep) { return new ElementFixture(this.tagName, Object.fromEntries(this.values), deep ? this.children.map((child) => child.cloneNode(true)) : []); }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map((item) => item.trim());
    return this.descendants().filter((node) => selectors.some((item) => {
      if (item === "*") return true;
      if (/^[a-z]+$/i.test(item)) return node.tagName.toLowerCase() === item.toLowerCase();
      if (item === "[data-customer-avatar]") return node.getAttribute("data-customer-avatar") !== null;
      if (item === "[role='menu']" || item === "[role='menuitem']") return node.getAttribute("role") === item.slice(7, -2);
      if (item === "[class*='avatar' i]") return /avatar/i.test(node.getAttribute("class") || "");
      return false;
    }));
  }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
}

const sanitizerPrelude = source.slice(source.indexOf("const UNSAFE_THEME_CLASS_PATTERN"), source.indexOf("function findHiddenThemeAccountControl"));
const sanitizeThemeOwnedAccountClone = new Function(
  "getAccountTriggerActionElement", "ACCOUNT_FALLBACK_DESKTOP_ID",
  `${sanitizerPrelude}; return sanitizeThemeOwnedAccountClone;`
)((element) => element, "megaska-account-fallback-desktop");
const safeThemeClasses = new Function(`${sanitizerPrelude}; return safeThemeClasses;`)( );

test("hidden Dawn-like account anchor is cloned and sanitized at runtime", () => {
  const svg = new ElementFixture("svg", { id: "account-icon", class: "icon icon-account", "aria-label": "Account" }, [new ElementFixture("path", { id: "account-path" })]);
  const avatar = new ElementFixture("span", { class: "customer-avatar", "data-customer-avatar": "1" }, [new ElementFixture("img", { src: "customer.jpg" })]);
  const sourceAnchor = new ElementFixture("a", {
    id: "HeaderAccount", href: "/account", class: "header__icon header__icon--account link focus-inset js-account active",
    "data-shopify-customer-account": "1", "aria-expanded": "false", "aria-controls": "account-menu", onclick: "nativeLogin()",
  }, [svg, avatar]);

  const clone = sanitizeThemeOwnedAccountClone(sourceAnchor, "/apps/megaska/account");
  assert.notEqual(clone, sourceAnchor);
  assert.equal(clone.getAttribute("id"), "megaska-account-fallback-desktop");
  assert.equal(clone.getAttribute("href"), "/apps/megaska/account");
  assert.equal(clone.getAttribute("data-megaska-open-login"), "1");
  assert.equal(clone.getAttribute("data-loopdesk-account-control-source"), "native-hidden-clone");
  assert.equal(clone.getAttribute("aria-label"), "My account");
  assert.equal(clone.getAttribute("aria-expanded"), null);
  assert.equal(clone.getAttribute("aria-controls"), null);
  assert.equal(clone.getAttribute("onclick"), null);
  assert.equal(clone.getAttribute("data-shopify-customer-account"), null);
  assert.equal(clone.querySelector("img"), null);
  assert.equal(clone.querySelector("[class*='avatar' i]"), null);
  assert.equal(clone.querySelector("svg").getAttribute("aria-hidden"), "true");
  assert.equal(clone.querySelector("svg").getAttribute("focusable"), "false");
  assert.equal(clone.querySelector("path").getAttribute("id"), null);
  assert.deepEqual(clone.classList, ["header__icon", "header__icon--account", "link", "focus-inset"]);
});

test("search and cart references derive only safe account presentation classes at runtime", () => {
  const search = new ElementFixture("a", { class: "header__icon header__icon--search link focus-inset js-search active" });
  const cart = new ElementFixture("a", { class: "header__icon header__icon--cart link focus-inset cart-drawer-hook" });
  const searchSvg = new ElementFixture("svg", { class: "icon icon-search search-icon" });

  assert.deepEqual(safeThemeClasses(search, { account: true }), ["header__icon", "link", "focus-inset", "header__icon--account"]);
  assert.deepEqual(safeThemeClasses(cart, { account: true }), ["header__icon", "link", "focus-inset", "header__icon--account"]);
  assert.deepEqual(safeThemeClasses(searchSvg, { svg: true }), ["icon", "icon-account"]);
});

test("adapter resolution and reconciliation cover all structural strategies", () => {
  const creation = functionSource("createDesktopAccountFallback", "clampAccountMetric");
  const insertion = functionSource("ensureDesktopAccountFallback", "observeDesktopAccountContainer");
  const visibility = functionSource("hasVisibleNativeDesktopAccountEntry", "hasKnownMegaskaSession");
  assert.match(creation, /findHiddenThemeAccountControl/);
  assert.match(creation, /sanitizeThemeOwnedAccountClone/);
  assert.match(creation, /findStructuralReference/);
  assert.match(creation, /reference-\$\{reference\.kind\}/);
  assert.match(creation, /loopdesk-default/);
  assert.match(insertion, /getElementById\(ACCOUNT_FALLBACK_DESKTOP_ID\)/);
  assert.match(insertion, /insertBefore\(fallback, cartCandidate\)/);
  assert.match(visibility, /native-visible/);
});

test("neutral fallback CSS is isolated from theme-native account controls", () => {
  const css = readFileSync(new URL("../megaska-otp/assets/megaska-otp.css", import.meta.url), "utf8");
  assert.match(css, /\.megaska-account-fallback--desktop\[data-loopdesk-account-control-source="loopdesk-default"\]/);
  assert.match(css, /#megaska-account-fallback-desktop\s*\{\s*display: none !important/);
  assert.doesNotMatch(css, /\[data-loopdesk-account-control-source="native-hidden-clone"\][^{]*\{[^}]*(?:width|background|color):/s);
});
