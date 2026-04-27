*** Begin Patch
*** Update File: services/gst/pdf.ts
@@
 import { getGstInvoiceById } from "./invoice";
 import { getGstNoteById } from "./notes";
+import { getSingleShopifyOrderForGstSync } from "./shopify-runtime-admin";
 import { getGstStatePrimaryNameByCode, resolveGstStateCode } from "./state-codes";
 import type { GstServiceResult } from "./types";
@@
 async function loadSourceOrderSnapshot(sourceOrderId: unknown): Promise<Record<string, unknown>> {
@@
   return order.snapshot as Record<string, unknown>;
 }

+function hasUsableCustomerDetails(snapshot: Record<string, unknown>): boolean {
+  const shipping = getObject(snapshot, ["shippingAddress", "shipping_address", "shipping"]);
+  const billing = getObject(snapshot, ["billingAddress", "billing_address", "billing"]);
+  const customer = getObject(snapshot, ["customer", "buyer"]);
+
+  return Boolean(
+    asText(snapshot.customerName) ||
+      asText(snapshot.email) ||
+      asText(snapshot.contactEmail) ||
+      asText(snapshot.phone) ||
+      asText(shipping.name) ||
+      asText(shipping.address1) ||
+      asText(shipping.phone) ||
+      asText(billing.name) ||
+      asText(billing.address1) ||
+      asText(billing.phone) ||
+      asText(customer.displayName) ||
+      asText(customer.email) ||
+      fullNameFromObject(customer)
+  );
+}
+
+async function loadLiveShopifyOrderSnapshot(document: Record<string, unknown>): Promise<Record<string, unknown>> {
+  const orderNameOrNumber =
+    asText(document.shopifyOrderName) ||
+    asText(document.sourceOrderNumber) ||
+    asText(document.sourceReference);
+
+  if (!orderNameOrNumber) return {};
+
+  try {
+    const liveOrder = await getSingleShopifyOrderForGstSync({ orderNameOrNumber });
+    if (liveOrder && typeof liveOrder === "object") {
+      return liveOrder as Record<string, unknown>;
+    }
+  } catch (error) {
+    console.error("[GST PDF] live Shopify order hydrate failed", {
+      orderNameOrNumber,
+      error: error instanceof Error ? error.message : String(error),
+    });
+  }
+
+  return {};
+}
+
 async function loadLinkedOrderSnapshot(document: Record<string, unknown>, snapshot: Record<string, unknown>): Promise<Record<string, unknown>> {
   const sourceSnapshot = getObject(snapshot, ["source"]);
-  if (Object.keys(sourceSnapshot).length > 0) {
+  if (Object.keys(sourceSnapshot).length > 0 && hasUsableCustomerDetails(sourceSnapshot)) {
     return sourceSnapshot;
   }

   const candidates: Array<{ field: "id" | "shopifyOrderId" | "shopifyOrderName"; value: string }> = [];
@@
     });
     if (order?.snapshot && typeof order.snapshot === "object") {
-      return order.snapshot as Record<string, unknown>;
+      const orderSnapshot = order.snapshot as Record<string, unknown>;
+      if (hasUsableCustomerDetails(orderSnapshot)) {
+        return orderSnapshot;
+      }
     }
   }

   if (sourceOrderId) {
-    return loadSourceOrderSnapshot(sourceOrderId);
+    const orderSnapshot = await loadSourceOrderSnapshot(sourceOrderId);
+    if (hasUsableCustomerDetails(orderSnapshot)) {
+      return orderSnapshot;
+    }
   }
-  return {};
+
+  return loadLiveShopifyOrderSnapshot(document);
 }
*** End Patch
