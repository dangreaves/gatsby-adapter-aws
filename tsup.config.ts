import { defineConfig } from "tsup";

export default defineConfig({
  dts: true,
  format: ["esm"],
  entry: ["src/index.ts", "src/handler.ts", "src/cli/main.ts"],
});
