// A tiny static app standing in for a real frontend, so the tests need no build and no backend.

import { defineConfig } from "../src/index.ts";

export default defineConfig({
  appUrl: "https://app.test",
  outputDir: ".output",
  build: { dist: "fixture-app" },
  viewport: { width: 400, height: 200 }
});
