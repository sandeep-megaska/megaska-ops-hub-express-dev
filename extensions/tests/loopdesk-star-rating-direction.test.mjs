import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const formScript = readFileSync("extensions/megaska-otp/assets/loopdesk-product-reviews.js", "utf8");
const formStyles = readFileSync("extensions/megaska-otp/assets/loopdesk-product-reviews.css", "utf8");
const storefrontStars = formScript.match(/function stars\(r\)\{.*?return n\}/s)?.[0];

test("storefront ratings render filled stars before empty stars", () => {
  assert.ok(storefrontStars, "the storefront star renderer is present");
  const render = Function("el", `${storefrontStars}; return stars;`)(
    (_tag, _className, textContent) => ({
      textContent,
      setAttribute(name, value) { this[name] = value; },
    }),
  );

  for (const [rating, expected] of [[5, "★★★★★"], [4, "★★★★☆"], [3, "★★★☆☆"], [2, "★★☆☆☆"], [1, "★☆☆☆☆"]]) {
    const stars = render(rating);
    assert.equal(stars.textContent, expected);
    assert.equal(stars["aria-label"], `${rating} out of 5 stars`);
  }
});

test("review form preserves one-to-five DOM order and fills toward the selected star", () => {
  assert.match(formScript, /\[1,2,3,4,5\]\.map\(function\(n\)/);
  assert.match(formStyles, /\.loopdesk-rating\{[^}]*direction:ltr/);
  assert.match(formStyles, /label:has\(~ label input:checked\) span/);
  assert.match(formStyles, /label:has\(~ label:hover\) span/);
  assert.doesNotMatch(formStyles, /row-reverse|direction:rtl/);
});

test("storefront stars explicitly isolate left-to-right rendering", () => {
  assert.match(formStyles, /\.loopdesk-stars\{[^}]*direction:ltr;unicode-bidi:isolate/);
});

test("standalone review form uses the same left-to-right selection and hover rules", () => {
  const script = readFileSync("public/loopdesk-review-submission.js", "utf8");
  const styles = readFileSync("public/loopdesk-review-submission.css", "utf8");
  assert.match(script, /\[1,2,3,4,5\]\.map\(n =>/);
  assert.match(styles, /\.loopdesk-review__stars\{[^}]*direction:ltr/);
  assert.match(styles, /label:has\(~ label input:checked\)/);
  assert.match(styles, /label:has\(~ label:hover\)/);
  assert.match(script, /<span class="sr-only">\$\{n\} star/);
});
