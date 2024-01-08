import { defineConfig } from "tsup";

export default defineConfig({
  dts: true,
  clean: true,
  format: ["esm"],
  publicDir: "src/assets",
  entry: ["src/index.ts", "src/handler.ts", "src/cli/main.ts"],
});
