import { test } from "node:test";
import assert from "node:assert/strict";
import { missingRequiredFields, renderTemplate } from "./template.ts";
import { deidentify } from "./ai-draft-deidentify.ts";

test("values are HTML-escaped", () => {
  const html = renderTemplate("<p>{{note}}</p>", {
    note: '<script>alert("x")</script>',
  });
  assert.ok(!html.includes("<script>"), "script tags must not survive");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("triple braces keep line breaks but still escape", () => {
  const html = renderTemplate("{{{note}}}", { note: "line one\nline <b>two</b>" });
  assert.ok(html.includes("<br />"));
  assert.ok(html.includes("&lt;b&gt;"), "markup inside a note is still escaped");
});

test("empty sections are omitted entirely", () => {
  // A summary must never print "Complications:" with nothing after it.
  const body = "{{#if complications}}<h2>Complications</h2>{{complications}}{{/if}}";
  assert.equal(renderTemplate(body, { complications: "" }), "");
  assert.equal(renderTemplate(body, {}), "");
  assert.equal(renderTemplate(body, { complications: "   " }), "");
  assert.ok(renderTemplate(body, { complications: "None" }).includes("Complications"));
});

test("lists render as list items", () => {
  const html = renderTemplate("{{exercises}}", { exercises: ["Bridge", "Dead bug"] });
  assert.ok(html.includes("<li>Bridge</li>"));
  assert.ok(html.includes("<li>Dead bug</li>"));
});

test("each blocks iterate and escape", () => {
  const html = renderTemplate("{{#each items}}<li>{{.}}</li>{{/each}}", {
    items: ["a & b", "<c>"],
  });
  assert.ok(html.includes("<li>a &amp; b</li>"));
  assert.ok(html.includes("<li>&lt;c&gt;</li>"));
});

test("measures render as a comparison table", () => {
  const html = renderTemplate("{{outcome_measures}}", {
    outcome_measures: [{ code: "NPRS", label: "Pain", initial: "8", current: "2" }],
  });
  assert.ok(html.includes("<table"));
  assert.ok(html.includes("Pain"));
  assert.ok(html.includes(">8<") && html.includes(">2<"));
});

test("an unknown field renders empty rather than throwing", () => {
  // A template edited to reference a removed field must not break an existing
  // document.
  assert.equal(renderTemplate("[{{gone}}]", {}), "[]");
});

test("missing required fields are reported by label", () => {
  const fields = [
    { key: "diagnosis", label: "Diagnosis", kind: "text" as const, required: true },
    { key: "notes", label: "Notes", kind: "textarea" as const },
    { key: "hep", label: "Home programme", kind: "list" as const, required: true },
  ];
  const missing = missingRequiredFields(fields, { diagnosis: "", hep: [] });
  assert.deepEqual(missing, ["Diagnosis", "Home programme"]);
  assert.deepEqual(missingRequiredFields(fields, { diagnosis: "x", hep: ["y"] }), []);
});

test("de-identification strips names, phones and emails", () => {
  const text =
    "Ramesh Kurian reported pain. Contact Ramesh on +91 98470 12345 or ramesh.k@example.com.";
  const clean = deidentify(text, ["Ramesh Kurian", "Ramesh", "Kurian", "+919847012345"]);
  assert.ok(!clean.includes("Ramesh"), "the patient's name must not leave the building");
  assert.ok(!clean.includes("98470"), "phone numbers must be stripped");
  assert.ok(!clean.includes("@example.com"), "emails must be stripped");
  assert.ok(clean.includes("reported pain"), "the clinical content must survive");
});
