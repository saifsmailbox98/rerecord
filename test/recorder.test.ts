import { test } from "node:test";

import { chromium } from "playwright";

import { assertRecorderAvailable } from "../src/recorder.ts";

// record depends on Playwright's private recorder, so a Playwright bump that drops it fails here
// and not halfway through someone's recording.
test("the Playwright recorder that record relies on still exists", async () => {
  const browser = await chromium.launch();
  try {
    assertRecorderAvailable(await browser.newContext());
  } finally {
    await browser.close();
  }
});
