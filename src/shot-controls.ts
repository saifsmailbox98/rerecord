// The 📸 Shot and ⏱ 5s buttons in the record window, and the pointer and hover tracking behind
// them. The functions passed to addInitScript run inside the page, so they only use what they
// are given.

import type { BrowserContext } from "playwright";

import type { Point, Pointer } from "./scene.ts";
import { describeAt } from "./steps.ts";

// The recorder drops any action whose selector mentions this, so pressing the buttons is never a step.
export const SHOT_LABEL = "rerecord-shot";

export const installShotControls = async (
  context: BrowserContext,
  { onPointer, onShot }: { onPointer: (pointer: Pointer) => void; onShot: (hover: Point | null) => number }
) => {
  await context.exposeBinding("__rerecordPointer", (_source, pointer: Pointer) => onPointer(pointer));
  await context.exposeBinding("__rerecordShot", (_source, hover: Point | null) => onShot(hover));
  await context.addInitScript(`window.__rerecordDescribeAt = ${describeAt.toString()};`);

  await context.addInitScript((label) => {
    if (window.top !== window) return;
    type PageWindow = Window & {
      __rerecordDescribeAt: (at: { x: number; y: number }) => string;
      __rerecordPointer: (pointer: { at: { x: number; y: number }; under: string }) => Promise<void>;
      __rerecordShot: (at: { x: number; y: number } | null) => Promise<number>;
    };
    const pageWindow = window as unknown as PageWindow;
    window.addEventListener(
      "pointerdown",
      (event) => {
        const at = { x: event.clientX, y: event.clientY };
        void pageWindow.__rerecordPointer({ at, under: pageWindow.__rerecordDescribeAt(at) });
      },
      true
    );
    // The recorder does not save hovers, so a timed shot keeps where the mouse is when the timer
    // ends and the replay moves the mouse back there before taking it.
    let hover: { x: number; y: number } | null = null;
    window.addEventListener(
      "mousemove",
      (event) => {
        const onControls = event.target instanceof Element && event.target.closest("[data-rerecord-shot]");
        hover = onControls ? null : { x: event.clientX, y: event.clientY };
      },
      true
    );

    document.addEventListener("DOMContentLoaded", () => {
      const controls = document.createElement("div");
      controls.setAttribute("data-rerecord-shot", "");
      controls.style.cssText =
        "position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;border-radius:8px;overflow:hidden;" +
        "box-shadow:0 2px 8px #0006;pointer-events:auto";
      const buttonStyle =
        "background:#facc15;color:#000;font:600 13px system-ui;border:0;cursor:pointer;padding:8px 14px;pointer-events:auto";

      const instant = document.createElement("button");
      instant.setAttribute("aria-label", label);
      instant.textContent = "📸 Shot";
      instant.style.cssText = buttonStyle;

      const timed = document.createElement("button");
      timed.setAttribute("aria-label", `${label}-timer`);
      timed.title = "Shot in 5 seconds, so you can hover something first";
      timed.textContent = "⏱ 5s";
      timed.style.cssText = `${buttonStyle};padding:8px 10px;border-left:1px solid #0003`;

      // An open Radix dialog makes the page click-through and closes itself on any press outside
      // it, so the controls opt back in to clicks and keep their presses away from the dialog.
      ["pointerdown", "mousedown"].forEach((type) =>
        controls.addEventListener(type, (event) => event.stopPropagation())
      );

      let counting = false;
      instant.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (counting) return;
        instant.textContent = `📸 Shot (${await pageWindow.__rerecordShot(null)})`;
      });
      timed.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (counting) return;
        counting = true;
        for (const left of [5, 4, 3, 2, 1]) {
          timed.textContent = `⏱ ${left}s`;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        instant.textContent = `📸 Shot (${await pageWindow.__rerecordShot(hover)})`;
        timed.textContent = "⏱ 5s";
        counting = false;
      });

      controls.append(instant, timed);
      document.body.appendChild(controls);
    });
  }, SHOT_LABEL);
};
