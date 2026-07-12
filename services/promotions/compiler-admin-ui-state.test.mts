import test from "node:test";
import assert from "node:assert/strict";
import { promotionCompileControlState } from "./compiler-admin-ui-state.ts";

const model = (code: any, currentCompilation: any = null) => ({ code, currentCompilation });

test("compile controls disable during active attempts and switch to compile again after ready", () => {
  assert.deepEqual(promotionCompileControlState("ACTIVE", model("PENDING")), { renderButton: true, disabled: true, label: "Compile promotion", activeStatus: "Queued" });
  assert.deepEqual(promotionCompileControlState("ACTIVE", model("COMPILING")), { renderButton: true, disabled: true, label: "Compile promotion", activeStatus: "Compiling" });
  assert.equal(promotionCompileControlState("ACTIVE", model("READY", { id: "c1" })).label, "Compile again");
});
