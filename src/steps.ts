// Runs one step from scene.json (click, fill, press, and so on) in the browser. Record and render
// share the selectors and the element description, so a replay clicks what was recorded.

import type { Locator, Page } from "playwright";

import type { Point, Step, Target } from "./scene.ts";
import { isStableSelector } from "./scene.ts";

type Role = Parameters<Page["getByRole"]>[0];

// A blank click has nothing to wait for (the spot may legitimately fill up), so it gives the page a
// moment to finish rendering what the previous step opened.
const BLANK_SETTLE_MS = 700;

// How long a position click waits for what was recorded there to appear.
const POSITION_WAIT_MS = 5000;

// Tooltips and hover cards open after a delay (Radix waits 700ms by default). Render's clock is
// frozen, so it is run forward this far and the tooltip opens without a real wait.
const HOVER_CLOCK_MS = 1200;
const HOVER_PAINT_MS = 150;

// How long a step may wait for a selector that still matches several elements to settle on one.
const AMBIGUOUS_WAIT_MS = 5000;

// Long enough for typical debounced requests (a few hundred ms) to have been answered.
const SETTLE_MS = 800;

export const locate = (page: Page, target: Target): Locator => {
  if ("selector" in target) return page.locator(target.selector);
  if ("role" in target) return page.getByRole(target.role as Role, { name: target.name, exact: target.exact });
  if ("placeholder" in target) return page.getByPlaceholder(target.placeholder);
  if ("label" in target) return page.getByLabel(target.label);
  return page.getByText(target.text, { exact: target.exact });
};

// Runs inside the page (record also installs it there), so it must stay self-contained.
export const describeAt = ({ x, y }: Point) => {
  const element = document.elementFromPoint(x, y);
  if (!element) return "nothing";
  const text = ((element as HTMLElement).innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return `${element.tagName.toLowerCase()} "${text}"`;
};

const isBlank = (description: string) => /^(html|body) /.test(description);

// An open Radix menu or sheet makes the rest of the page click-through, so a click outside it
// lands on <html>. Radix also opens menus on pointerdown, so the click that opens one lands on
// <html> too; what was under the pointer at pointerdown (`under`) tells the two apart. A real
// blank click only means something while that spot is still empty page.
const isBlankClick = (target: Target, under?: string) =>
  "selector" in target && (target.selector === "html" || target.selector === "body") && (!under || isBlank(under));

// Polls what is at `at` until it matches what was there when recording, or gives up.
const waitForElementAt = async (page: Page, at: Point, under: string) => {
  const deadline = Date.now() + POSITION_WAIT_MS;
  for (;;) {
    const found = await page.evaluate(describeAt, at);
    if (found === under) return;
    if (Date.now() > deadline) {
      throw new Error(
        `The UI moved: expected ${under} at ${Math.round(at.x)},${Math.round(at.y)} but found ${found}. Record this scene again.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

// Returns false when a recorded blank click is skipped because something is there now.
const clickPosition = async (page: Page, target: Target, at: Point, under?: string) => {
  if (isBlankClick(target, under)) {
    await page.waitForTimeout(BLANK_SETTLE_MS);
    if (!isBlank(await page.evaluate(describeAt, at))) return false;
  } else if (under) {
    await waitForElementAt(page, at, under);
  } else {
    await page.waitForTimeout(BLANK_SETTLE_MS);
  }
  await page.mouse.click(at.x, at.y);
  return true;
};

// A click that navigates leaves the previous page on screen for a moment, and Playwright fails at
// once when a selector matches several elements there (a bundle name listed on every session row,
// say). Retrying for a few seconds lets the next page arrive; a selector that stays ambiguous still fails.
const onceUnambiguous = async (action: () => Promise<void>) => {
  const deadline = Date.now() + AMBIGUOUS_WAIT_MS;
  for (;;) {
    try {
      return await action();
    } catch (error) {
      if (!/strict mode violation/.test((error as Error).message) || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
};

// Clicks where the click was recorded inside the element, while that spot still falls inside it;
// a moved or resized element is clicked in its middle, as a plain locator click would.
const clickInside = (page: Page, target: Target, at: Point) =>
  onceUnambiguous(async () => {
    const locator = locate(page, target);
    await locator.waitFor();
    const box = await locator.boundingBox();
    const isInside = box && at.x >= box.x && at.x <= box.x + box.width && at.y >= box.y && at.y <= box.y + box.height;
    await locator.click(isInside ? { position: { x: at.x - box.x, y: at.y - box.y } } : undefined);
  });

const isFragileTarget = (target: Target) => "selector" in target && !isStableSelector(target.selector);

export const runStep = async (page: Page, step: Step, onShot: (output: string) => Promise<void>) => {
  if ("goto" in step) {
    await page.goto(step.goto);
  } else if ("click" in step) {
    if (step.at && isFragileTarget(step.click)) await clickPosition(page, step.click, step.at, step.under);
    else if (step.at) await clickInside(page, step.click, step.at);
    else await onceUnambiguous(() => locate(page, step.click).click());
  } else if ("fill" in step) {
    if (step.at) {
      if (await clickPosition(page, step.fill, step.at, step.under)) {
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.insertText(step.value);
      }
    } else {
      await onceUnambiguous(() => locate(page, step.fill).fill(step.value));
    }
  } else if ("press" in step) {
    const { target } = step;
    await (target ? onceUnambiguous(() => locate(page, target).press(step.press)) : page.keyboard.press(step.press));
  } else if ("waitFor" in step) {
    await onceUnambiguous(() => locate(page, step.waitFor).waitFor());
  } else if ("selectOption" in step) {
    await onceUnambiguous(async () => {
      await locate(page, step.selectOption).selectOption(step.values);
    });
  } else if ("shot" in step) {
    await page.waitForTimeout(SETTLE_MS);
    if (step.hover) {
      await page.mouse.move(step.hover.x, step.hover.y);
      await page.clock.runFor(HOVER_CLOCK_MS);
      await page.waitForTimeout(HOVER_PAINT_MS);
    }
    await onShot(step.shot);
  }
};

export const describeStep = (step: Step) => JSON.stringify(step);
