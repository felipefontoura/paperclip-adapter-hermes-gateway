import { defineConfig } from "tsup";

// 3 entries map to the `exports` block in package.json:
//   .          → dist/index.js          (root + createServerAdapter)
//   ./server   → dist/server/index.js   (execute, testEnvironment)
//   ./ui       → dist/ui/index.js       (buildHermesGatewayConfig)
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "server/index": "src/server/index.ts",
    "ui/index": "src/ui/index.ts",
  },
  outDir: "dist",
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  shims: false,
});
