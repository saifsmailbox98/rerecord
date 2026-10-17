// Runs one step from scene.json (click, fill, press, and so on) in the browser. Record and render
// share the selectors and the element description, so a replay clicks what was recorded.

import type { Locator, Page } from "playwright";

import type { Point, Step, Target } from "./scene.ts";

type Role = Parameters<Page["getByRole"]>[0];

// Clicking a position does not wait for the element the way a locator does, so give the page
// time to finish rendering what the previous step opened.
const POSITION_SETTLE_MS = 700;

// Tooltips and hover cards open after a delay (Radix waits 700ms by default).
const HOVER_SETTLE_MS = 1200;

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

// Returns false when a recorded blank click is skipped because something is there now.
const clickPosition = async (page: Page, target: Target, at: Point, under?: string) => {
  await page.waitForTimeout(POSITION_SETTLE_MS);
  const found = await page.evaluate(describeAt, at);
  if (isBlankClick(target, under)) {
    if (!isBlank(found)) return false;
  } else if (under && found !== under) {
    throw new Error(
      `The UI moved: expected ${under} at ${Math.round(at.x)},${Math.round(at.y)} but found ${found}. Record this scene again.`
    );
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

export const runStep = async (page: Page, step: Step, onShot: (output: string) => Promise<void>) => {
  if ("goto" in step) {
    await page.goto(step.goto);
  } else if ("click" in step) {
    if (step.at) await clickPosition(page, step.click, step.at, step.under);
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
      await page.waitForTimeout(HOVER_SETTLE_MS);
    }
    await onShot(step.shot);
  }
};

export const describeStep = (step: Step) => JSON.stringify(step);
