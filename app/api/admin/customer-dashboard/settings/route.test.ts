import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("admin route resolves shop server-side and ignores body shopId", () => { const src = readFileSync("app/api/admin/customer-dashboard/settings/route.ts", "utf8"); assert.match(src, /resolveAdminShopFromRequest\(req\)/); assert.match(src, /shopId: resolved\.shop\.id/); assert.doesNotMatch(src, /body\.shopId/); });
test("admin route masks internal errors", () => { const src = readFileSync("app/api/admin/customer-dashboard/settings/route.ts", "utf8"); assert.match(src, /Unable to save customer dashboard settings/); assert.match(src, /CustomerDashboardSettingsValidationError/); });
