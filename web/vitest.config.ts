import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config.ts";

// Tests run the same compiled components the build ships. The Worker's tests
// pick the Node environment themselves.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    css: true,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
}));
