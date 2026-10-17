import assert from "node:assert/strict";
import { test } from "node:test";

import { chromium } from "playwright";

import { assertRecorderAvailable, normalizedSelector } from "../src/recorder.ts";

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

test("fragile CSS selectors become text or role selectors while the element is there", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="css-13cymwt-control"><div class="css-1dimb5e">No Access</div></div>
      <div class="css-a">Twice</div><div class="css-b">Twice</div>`);
    assert.equal(await normalizedSelector(page, ".css-13cymwt-control > .css-1dimb5e"), 'internal:text="No Access"i');
    // Repeated text gets the same position-in-list form the recorder uses, which holds because
    // render replays the same data.
    assert.equal(await normalizedSelector(page, ".css-a"), 'internal:text="Twice"i >> nth=0');
    // Gone (an option in a menu that closed): the step keeps its recorded spot.
    assert.equal(await normalizedSelector(page, ".css-gone"), null);
  } finally {
    await browser.close();
  }
});
