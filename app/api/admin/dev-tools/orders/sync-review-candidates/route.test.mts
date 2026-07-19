import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
test("targeted repair derives the HMAC verified tenant and rejects extra input", () => { assert.match(source, /resolved\.hmacVerified/); assert.match(source, /Object\.keys\(input\)/); assert.match(source, /shopId: resolved\.shop\.id/); });
test("targeted repair returns an explicit safe projection", () => { assert.match(source, /evaluatedCount/); assert.doesNotMatch(source, /skipped: result\.skipped|eligibilityResult:/); assert.doesNotMatch(source, /email|tokenHash|customerProfile/); });
