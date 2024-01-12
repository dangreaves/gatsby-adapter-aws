import { defineConfig } from "tsup";

export default defineConfig({
  dts: true,
  format: ["esm"],
  splitting: false,
  entry: ["src/cdk/index.ts", "src/adapter/index.ts", "src/adapter/handler.ts"],
});
