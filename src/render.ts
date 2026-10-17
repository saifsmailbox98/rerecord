// Draws a scene's screenshots with no backend: loads the built app, answers every API call from the
// scene's recording, runs its steps, and saves a screenshot at each shot step.

import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import type { ResolvedConfig } from "./config.ts";
import { escapeRegExp, RENDER_ORIGIN } from "./config.ts";
import { readHar, requestKey } from "./har.ts";
import { loadScene } from "./scene.ts";
import { describeStep, runStep } from "./steps.ts";

const FREEZE_CSS =
  "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }";

type Answer = { status: number; headers: Record<string, string>; body: Buffer };

// Each request gets its recorded answers in order, then keeps getting the last one, so a list
// fetched before and after a save shows both states.
const loadAnswers = (harPath: string) => {
  const answers = new Map<string, Answer[]>();
  for (const entry of readHar(harPath).log.entries) {
    const key = requestKey(entry.request.method, entry.request.url, entry.request.postData?.text);
    const { content } = entry.response;
    answers.set(key, [
      ...(answers.get(key) ?? []),
      {
        status: entry.response.status,
        headers: Object.fromEntries(entry.response.headers.map((h) => [h.name, h.value])),
        body: Buffer.from(content.text ?? "", content.encoding === "base64" ? "base64" : "utf8")
      }
    ]);
  }
  return answers;
};

// Returns the screenshot files it wrote.
export const render = async (config: ResolvedConfig, sceneName: string) => {
  const dist = config.build.dist;
  if (!existsSync(path.join(dist, "index.html"))) {
    throw new Error(`No app build at ${dist}. Build it first, or set build.command in the config.`);
  }
  const scene = loadScene(config, sceneName);
  const apiUrl = `${RENDER_ORIGIN}${config.apiPrefix}`;
  const answers = loadAnswers(path.join(scene.dir, "network.har"));
  const served = new Map<string, number>();

  const browser = await chromium.launch();
  const written: string[] = [];
  try {
    const context = await browser.newContext({
      baseURL: RENDER_ORIGIN,
      viewport: scene.viewport,
      deviceScaleFactor: 2,
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
      serviceWorkers: "block"
    });
    await context.addInitScript((css) => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
      });
    }, FREEZE_CSS);

    // Playwright tries the most recently registered route first, so the API route goes last.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== RENDER_ORIGIN) return route.abort();
      const file = path.join(dist, decodeURIComponent(url.pathname));
      if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) return route.fulfill({ path: file });
      // Only page loads fall back to the app shell (a route like /users/jane.doe included); a missing
      // script must fail, not run as HTML.
      if (route.request().resourceType() !== "document") return route.fulfill({ status: 404 });
      return route.fulfill({ path: path.join(dist, "index.html") });
    });
    for (const [stubPath, stub] of Object.entries(config.stubs)) {
      await context.route(`${RENDER_ORIGIN}${stubPath}`, (route) => route.fulfill(stub));
    }
    await context.route(new RegExp(`^${escapeRegExp(apiUrl)}`), (route) => {
      const request = route.request();
      const key = requestKey(request.method(), request.url(), request.postData());
      const queue = answers.get(key);
      if (!queue) return route.abort();
      const count = served.get(key) ?? 0;
      served.set(key, count + 1);
      return route.fulfill(queue[Math.min(count, queue.length - 1)]);
    });

    const page = await context.newPage();
    const missing: string[] = [];
    page.on("requestfailed", (request) => {
      // The app also cancels requests itself (net::ERR_ABORTED); only an unanswered one means the
      // scene is out of date.
      if (request.url().startsWith(apiUrl) && request.failure()?.errorText === "net::ERR_FAILED") {
        missing.push(`${request.method()} ${request.url().replace(RENDER_ORIGIN, "")}`);
      }
    });
    const failIfMissing = () => {
      if (missing.length) {
        throw new Error(
          `Scene ${scene.name} asked for API answers it never recorded. Edit its network.har or record it again.\n  ${[...new Set(missing)].join("\n  ")}`
        );
      }
    };

    await page.clock.setFixedTime(new Date(scene.frozenTime));
    await page.goto(scene.startUrl);
    for (const step of scene.steps) {
      try {
        await runStep(page, step, async (output) => {
          failIfMissing();
          const file = path.join(config.outputDir, output);
          mkdirSync(path.dirname(file), { recursive: true });
          await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
          written.push(file);
        });
      } catch (error) {
        failIfMissing();
        throw new Error(`Scene ${scene.name}, step failed: ${describeStep(step)}\n${(error as Error).message}`);
      }
    }
    failIfMissing();
  } finally {
    await browser.close();
  }
  return written;
};
