import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Must match the secret `make run` starts the local Lambda with. */
const DEV_SHARED_SECRET = "local-development-secret";

export default defineConfig({
  plugins: [
    react(),
    // A component the React Compiler cannot compile fails the build rather than
    // silently losing its memoization.
    babel({ presets: [reactCompilerPreset({ panicThreshold: "all_errors" })] }),
  ],
  server: {
    proxy: {
      // `make run` serves the Lambda with `cargo lambda watch`. The proxy stands
      // in for the Worker, so it adds the secret but checks nothing.
      "/scrape/": {
        target: "http://127.0.0.1:9000",
        rewrite: (path) => `/lambda-url/cloud-web-scraper${path}`,
        headers: { "x-scraper-secret": DEV_SHARED_SECRET },
      },
    },
  },
});
