import { defineConfig } from "vite";

// The Worker ships as one ES module, dist-worker/worker.js, which wiz-vm
// uploads as the script's main module. It stays unminified so a deployed
// version reads like its source.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist-worker",
    emptyOutDir: true,
    target: "es2022",
    minify: false,
    lib: {
      entry: "worker/index.ts",
      formats: ["es"],
      fileName: () => "worker.js",
    },
  },
});
