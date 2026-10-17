// Turns what Playwright's recorder (the engine behind codegen) sees into scene steps. The recorder
// is not public API, so it is only reached through startRecorder here; Playwright is pinned, so
// this needs re-testing only when it is bumped.

import type { BrowserContext, Locator, Page } from "playwright";

import type { Pointer, Step } from "./scene.ts";
import { isStableSelector } from "./scene.ts";
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

const toStep = (action: RecordedAction, pointer: Pointer | null, origin: string): Step | null => {
  const target = action.selector ? { selector: action.selector } : undefined;
  if (action.selector?.includes(SHOT_LABEL)) return null;
  const isFragile = Boolean(action.selector) && !isStableSelector(action.selector ?? "");
  // Every click keeps its spot and what was under the pointer there. Where you click can matter (a
  // dialog's backdrop closes it, its middle does not), and the recorder sometimes names the wrong
  // element: a click on a Radix backdrop is reported as a click on the dialog itself.
  const position = isFragile && pointer ? pointer : {};
  const spot = pointer ?? {};
  switch (action.name) {
    case "click":
    case "check":
    case "uncheck":
      return target ? { click: target, ...spot } : null;
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
// A click keeps its spot and what was there; a fill has no use for either.
const improve = async (page: Page, steps: (Step | null)[], index: number) => {
  const step = steps[index];
  if (!step || !("click" in step || "fill" in step)) return;
  const target = "click" in step ? step.click : step.fill;
  if (!("selector" in target) || isStableSelector(target.selector)) return;
  if (target.selector === "html" || target.selector === "body") return;
  const better = await normalizedSelector(page, target.selector);
  if (!better || steps[index] !== step) return;
  if ("click" in step) {
    steps[index] = { ...step, click: { selector: better } };
  } else {
    const { at: _at, under: _under, ...rest } = step;
    steps[index] = { ...rest, fill: { selector: better } };
  }
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
