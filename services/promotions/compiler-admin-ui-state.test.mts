import test from "node:test";
import assert from "node:assert/strict";
import { promotionCompileControlState } from "./compiler-admin-ui-state.ts";

const model = (code: any, currentCompilation: any = null, latestAttempt: any = null) => ({ code, currentCompilation, latestAttempt });

test("compile controls enable the initial queued fallback, disable real active attempts, and switch to compile again after ready", () => {
  assert.deepEqual(promotionCompileControlState("ACTIVE", model("PENDING")), {
    renderButton: true,
    disabled: false,
    label: "Compile promotion",
  });
  assert.deepEqual(promotionCompileControlState("ACTIVE", model("PENDING", null, { status: "PENDING" })), {
    renderButton: true,
    disabled: true,
    label: "Compile promotion",
    activeStatus: "Queued",
  });
  assert.deepEqual(promotionCompileControlState("ACTIVE", model("COMPILING", null, { status: "COMPILING" })), {
    renderButton: true,
    disabled: true,
    label: "Compile promotion",
    activeStatus: "Compiling",
  });
  assert.equal(promotionCompileControlState("ACTIVE", model("READY", { id: "c1" })).label, "Compile again");
});
