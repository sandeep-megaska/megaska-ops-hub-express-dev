import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReviewBody, normalizeReviewDisplayName, normalizeReviewTitle } from "./review-content.ts";
test("review content is normalized as bounded plain text", () => { assert.equal(normalizeReviewTitle("  Great\r\nfit ").value, "Great\nfit"); assert.equal(normalizeReviewBody("<script>x</script>").error, "HTML is not allowed."); assert.equal(normalizeReviewBody("\u0000Hello").value, "Hello"); });
test("display names do not disclose contact information", () => { assert.ok(normalizeReviewDisplayName("buyer@example.com").error); assert.ok(normalizeReviewDisplayName("+1 555 123 4567").error); assert.equal(normalizeReviewDisplayName("Maria K.").value, "Maria K."); });
