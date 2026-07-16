import assert from "node:assert/strict";
import test from "node:test";
import { defaultReviewDisplayName } from "./review-display-name.ts";
test("display name defaults preserve buyer privacy", () => { assert.equal(defaultReviewDisplayName({ firstName: "Sandeep", lastName: "Desai" }), "Sandeep D."); assert.equal(defaultReviewDisplayName({ firstName: "Maria" }), "Maria"); assert.equal(defaultReviewDisplayName(null), "Verified buyer"); });
