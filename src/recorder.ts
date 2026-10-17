// Turns what Playwright's recorder (the engine behind codegen) sees into scene steps. The recorder
// is not public API, so it is only reached through startRecorder here; Playwright is pinned, so
// this needs re-testing only when it is bumped.

import type { BrowserContext, Locator, Page } from "playwright";

import type { Pointer, Step } from "./scene.ts";
import { SHOT_LABEL } from "./shot-controls.ts";

type RecordedAction = {
  name: string;
  selector?: string;
  text?: string;
  key?: string;
  options?: string[];
  url?: string;
};

type RecorderEvent = { action: RecordedAction };

type RecorderContext = BrowserContext & {
  _enableRecorder?: (
    params: { mode: "recording"; recorderMode: "api" },
    sink: {
      actionAdded: (page: Page, event: RecorderEvent) => void;
      actionUpdated: (page: Page, event: RecorderEvent) => void;
    }
  ) => Promise<void>;
};

export const assertRecorderAvailable = (context: BrowserContext) => {
  if (typeof (context as RecorderContext)._enableRecorder !== "function") {
    throw new Error("This Playwright version no longer has the recorder rerecord uses (_enableRecorder). Install the Playwright version rerecord pins.");
  }
};

// Selectors built from roles, labels, placeholders, test ids or text survive a UI change. When an
// element has none of those, the recorder falls back to CSS classes and positions (sometimes
// focus-only classes such as border-ring), which do not even match on the next run. Those
// steps replay as a click on the same spot, checked against what was there when you clicked.
const isStableSelector = (selector: string) =>
  /^internal:(role|label|testid|text|attr=\[placeholder)/.test(selector) && !/(^|\s)\./.test(selector);

const toStep = (action: RecordedAction, pointer: Pointer | null, origin: string): Step | null => {
  const target = action.selector ? { selector: action.selector } : undefined;
  if (action.selector?.includes(SHOT_LABEL)) return null;
  const position = action.selector && !isStableSelector(action.selector) && pointer ? pointer : {};
  switch (action.name) {
    case "click":
    case "check":
    case "uncheck":
      return target ? { click: target, ...position } : null;
    case "fill":
      return target ? { fill: target, value: action.text ?? "", ...position } : null;
    case "press":
      return { press: action.key ?? "", ...("at" in position ? {} : { target }) };
    case "select":
      return target ? { selectOption: target, values: action.options ?? [] } : null;
    case "navigate":
      return action.url ? { goto: action.url.replace(origin, "") } : null;
    default:
      return null;
  }
};

// Playwright can rewrite a selector into the role, label or text form it would pick itself
// (Locator.normalize). It only works while the element is still there, so a click that removed
// its own element (an option in a menu that then closed) keeps the recorded selector and spot.
// The selector string lives in a private field; without it the step stays as recorded.
export const normalizedSelector = async (page: Page, selector: string) => {
  try {
    const normalized = (await page.locator(selector).normalize()) as Locator & { _selector?: string };
    const better = normalized._selector;
    if (!better || !isStableSelector(better)) return null;
    return (await page.locator(better).count()) === 1 ? better : null;
  } catch {
    return null;
  }
};

// A step that fell back to a position gets the normalized selector in its place when there is one.
const improve = async (page: Page, steps: (Step | null)[], index: number) => {
  const step = steps[index];
  if (!step || !("at" in step) || !step.at || !("click" in step || "fill" in step)) return;
  const target = "click" in step ? step.click : step.fill;
  if (!("selector" in target) || target.selector === "html" || target.selector === "body") return;
  const better = await normalizedSelector(page, target.selector);
  if (!better || steps[index] !== step) return;
  const { at: _at, under: _under, ...rest } = step;
  steps[index] = "click" in rest ? { ...rest, click: { selector: better } } : { ...rest, fill: { selector: better } };
};

// Appends each recorded action to `steps`, the same list shots go into, so the two keep their order.
// Actions the scene cannot use are kept as null until the caller filters them out.
export const startRecorder = async (
  context: BrowserContext,
  { steps, origin, lastPointer }: { steps: (Step | null)[]; origin: string; lastPointer: () => Pointer | null }
) => {
  let lastRecorded = -1;
  const improving: Promise<void>[] = [];
  await (context as RecorderContext)._enableRecorder?.(
    { mode: "recording", recorderMode: "api" },
    {
      actionAdded: (page, { action }) => {
        lastRecorded = steps.push(toStep(action, lastPointer(), origin)) - 1;
        improving.push(improve(page, steps, lastRecorded));
      },
      // Typing arrives as one fill that keeps growing, so an update replaces the action it grew
      // from (never a shot taken in between), keeping the spot it started at.
      actionUpdated: (page, { action }) => {
        if (lastRecorded === -1) return;
        const previous = steps[lastRecorded];
        const pointer =
          previous && "at" in previous && previous.at ? { at: previous.at, under: previous.under ?? "" } : lastPointer();
        steps[lastRecorded] = toStep(action, pointer, origin);
        improving.push(improve(page, steps, lastRecorded));
      }
    }
  );
  // Wait for these before saving the steps.
  return () => Promise.allSettled(improving);
};
