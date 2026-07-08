import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../dist/README.md", import.meta.url),
  "CONFIG-2F.5B placeholder build artifact. Compile to function.wasm when enforcement is implemented.\n",
);
console.log("LoopDesk discount function foundation build placeholder completed.");
