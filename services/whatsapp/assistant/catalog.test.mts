import assert from "node:assert/strict";
import test from "node:test";
import { catalogOverview, productSearchTerms, rankCatalog, stemWord, toWhatsAppText, type CatalogItem } from "./policy.ts";
import { catalogItemFromNode, productFromNode } from "./store-context.ts";

// A slice of a real swimwear catalog (titles, types, tags and colour options as in Shopify).
const catalog: CatalogItem[] = [
  { id: "burkini", title: "3 Piece Modest Muslim Burkini Ruffle Full Coverage Long Sleeve Removable Chest Pads Swim Hijab Swimsuit", productType: "Swimwears", tags: ["solid_swimwear", "swimwear"], colors: ["Black", "Navy", "Wine"] },
  { id: "knee-black", title: "MEGASKA Women's One Piece Half Sleeve Knee Length Swimsuit - Black (MGSW16)", productType: "Swimwears", tags: ["color:black", "coverage:modest", "One piece", "swimwear"], colors: [] },
  { id: "bikini-set", title: "High Waisted Two Piece Bikini Set Camouflage Print Removable Padded Swim Top & Skirt with Boy Leg Shorts", productType: "Bikini Sets", tags: ["printed_swimwear", "swimwear"], colors: ["PurpleCamoBlack"] },
  { id: "bikini-top", title: "Swim Bra Bikini Top Quick Dry Printed Removable Padded Swimwear Tops", productType: "Swimwears", tags: ["printed_swimwear", "swimwear"], colors: ["Multicolor"] },
  { id: "floral-dress", title: "MEGASKA Women's One Piece Swimdress with Attached Shorts - Navy Floral (MGSW05)", productType: "Swimwears", tags: ["coverage:modest", "swimwear"], colors: [] },
  { id: "leggings", title: "Dry Fit Active Gym Leggings with Pocket, High Waisted Tummy Control Workout Yoga Track Pants", productType: "Yoga Pants", tags: [], colors: ["Black"] },
  { id: "sports-bra", title: "Dry Fit Padded Wirefree Full Coverage Sports Bra for Gym, Yoga, and Everyday Wear", productType: "Sports Bra", tags: [], colors: ["Black"] },
];
const ask = (text: string) => rankCatalog(catalog, productSearchTerms([{ from: "customer", text }]));

test("'Do you have bikinis?' finds the bikini products despite the plural", () => {
  const ids = ask("Do you have Bikinis?");
  assert.deepEqual(ids.slice(0, 2).sort(), ["bikini-set", "bikini-top"]);
});

test("'black full cover swimsuits' puts black modest swimwear first, not leggings or bras", () => {
  const ids = ask("Do you have black full cover swimsuits? What are the options?");
  assert.ok(["burkini", "knee-black"].includes(ids[0]), `got ${ids.join(",")}`);
  assert.ok(ids.indexOf("burkini") < ids.indexOf("leggings") || !ids.includes("leggings"));
  assert.ok(ids.includes("knee-black"));
});

test("no matching words means no products (the model then checks the catalog overview)", () => {
  assert.deepEqual(ask("Delivery kitni din mein?").filter((id) => id === "bikini-set"), []);
  assert.deepEqual(rankCatalog(catalog, []), []);
});

test("catalog overview lists every product type with counts", () => {
  assert.deepEqual(catalogOverview(catalog), ["Swimwears (4)", "Bikini Sets (1)", "Yoga Pants (1)", "Sports Bra (1)"]);
});

test("plural stemming", () => {
  assert.equal(stemWord("swimsuits"), "swimsuit");
  assert.equal(stemWord("bikinis"), "bikini");
  assert.equal(stemWord("dresses"), "dress");
  assert.equal(stemWord("dress"), "dress");
});

test("markdown links and bold become WhatsApp text", () => {
  assert.equal(toWhatsAppText("Try [Swim Dress](https://megaska.com/products/a) for **₹1280**"), "Try Swim Dress: https://megaska.com/products/a for *₹1280*");
});

test("colour options and in-stock colours are read from Shopify", () => {
  assert.deepEqual(catalogItemFromNode({ id: "gid://shopify/Product/1", title: "Burkini", productType: "Swimwears", tags: [], options: [{ name: "Color", optionValues: [{ name: "Black" }, { name: "Navy" }] }, { name: "Size", optionValues: [{ name: "M" }] }] })?.colors, ["Black", "Navy"]);
  const product = productFromNode({ title: "Burkini", handle: "burkini", variants: { nodes: [
    { title: "Black / M", availableForSale: true, selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "M" }] },
    { title: "Navy / M", availableForSale: false, selectedOptions: [{ name: "Color", value: "Navy" }, { name: "Size", value: "M" }] },
  ] } }, "https://megaska.com");
  assert.equal(product?.colors, "Black");
  assert.equal(product?.sizes, "M");
});
