import { defineConfig } from "tsup";

export default defineConfig({
  dts: true,
  format: ["esm"],
  entry: [
    "src/cli/main.ts",
    "src/cdk/index.ts",
    "src/adapter/index.ts",
    "src/adapter/handler.ts",
  ],
});
