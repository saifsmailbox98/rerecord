// Opens the live app in a normal browser window. The user clicks through a flow and presses Shot
// (now) or the 5s timer (time to hover something first) whenever the screen should become an
// image. When the window closes, the steps (scene.json) and the API answers the session got
// (network.har) are saved as a scene.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BrowserContext } from "playwright";
import { chromium } from "playwright";

import type { ResolvedConfig } from "./config.ts";
import { ensureStateDir, escapeRegExp } from "./config.ts";
import { assertRecorderAvailable, startRecorder } from "./recorder.ts";
import type { Pointer, SceneFile, Step } from "./scene.ts";
import { SCENE_VERSION } from "./scene.ts";
import { installShotControls } from "./shot-controls.ts";
import { scrubHar } from "./scrub.ts";

export const stampedName = () => {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}_${randomUUID()}`;
};

// Returns the name of the scene it saved.
export const record = async (config: ResolvedConfig, { name = stampedName(), url = "/" }: { name?: string; url?: string } = {}) => {
  const sceneDir = path.join(config.scenesDir, name);
  if (existsSync(sceneDir)) {
    throw new Error(`Scene ${name} already exists. To redo a scene, record a new one and delete the old one.`);
  }
  const origin = config.appUrl;
  // Keeps you logged in between recordings. Cookies only: localStorage left over from one run (such
  // as "intro already seen") would make the next recording see a different app than its replays do.
  const authFile = path.join(ensureStateDir(config), "auth.json");
  const saveSession = async (context: BrowserContext) => {
    const { cookies } = await context.storageState();
    writeFileSync(authFile, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`);
  };

  const steps: (Step | null)[] = [];
  let lastPointer: Pointer | null = null;
  // Set once recording starts, so the login before it never trips the password checks.
  let isRecording = false;
  let passwordProblem: string | null = null;
  const flagPassword = (what: string) => {
    if (!isRecording || passwordProblem) return;
    passwordProblem = what;
    console.log(`  ⚠ ${what}, so this recording can't be saved. Close the window, then record again without it.`);
  };

  // The raw recording holds cookies, tokens and real emails, so it is written outside the project
  // and only its scrubbed copy reaches the scene folder.
  const rawDir = mkdtempSync(path.join(tmpdir(), "rerecord-"));
  const rawHarPath = path.join(rawDir, "network.har");
  try {
    const browser = await chromium.launch({ headless: false, handleSIGINT: false });
    const context = await browser.newContext({
      storageState: existsSync(authFile) ? authFile : undefined,
      ignoreHTTPSErrors: true,
      baseURL: origin,
      viewport: config.viewport,
      locale: "en-US",
      timezoneId: "UTC",
      // Anchored on the origin: dev servers can serve source files whose paths also contain the prefix.
      recordHar: { path: rawHarPath, urlFilter: new RegExp(`^${escapeRegExp(origin + config.apiPrefix)}`), content: "embed" }
    });
    try {
      assertRecorderAvailable(context);
    } catch (error) {
      await browser.close();
      throw error;
    }

    await installShotControls(context, {
      onPointer: (pointer) => {
        lastPointer = pointer;
      },
      onPasswordTyped: () => flagPassword("A password was typed into the page"),
      onShot: (hover) => {
        const output = `${stampedName()}.png`;
        steps.push(hover ? { shot: output, hover } : { shot: output });
        console.log(`  shot ${output}${hover ? ` (hovering at ${Math.round(hover.x)},${Math.round(hover.y)})` : ""}`);
        return steps.filter((step) => step && "shot" in step).length;
      }
    });

    const page = await context.newPage();
    await page.goto(url);
    if (!config.isReady(new URL(page.url()))) {
      console.log("Log in in the browser window if it asks. Recording starts once you reach the app.");
    }
    await page.waitForURL(config.isReady, { timeout: 10 * 60_000 });
    await page.waitForLoadState("load");
    await saveSession(context);

    // Reloading gives the scene a clean first load: scrub keeps only what was asked from here on, so
    // a login typed into the window or a stale-session 401 never reaches the recording.
    const recordingStarted = new Date();
    await page.reload();
    await page.waitForLoadState("load");
    const startUrl = page.url().replace(origin, "");

    // Ctrl+C can kill the browser before the end of the run, so keep a rotated cookie as it changes.
    context.on("response", (response) => {
      if (config.saveSessionOn(response.url())) void saveSession(context).catch(() => {});
    });

    context.on("request", (request) => {
      if (request.url().startsWith(origin + config.apiPrefix) && /"password"\s*:/.test(request.postData() ?? "")) {
        flagPassword("A request just sent a password");
      }
    });

    await startRecorder(context, { steps, origin, lastPointer: () => lastPointer });
    isRecording = true;
    console.log(`Recording from ${startUrl}. Press 📸 Shot for each image, then close the window or press Ctrl+C.`);

    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      process.once("SIGINT", finish);
      browser.once("disconnected", finish);
      const finishIfNoPages = () => {
        if (context.pages().length === 0) finish();
      };
      page.on("close", finishIfNoPages);
      context.on("page", (opened) => opened.on("close", finishIfNoPages));
    });
    // After Ctrl+C the browser may already be going down; the cookie was saved as it rotated.
    await saveSession(context).catch(() => {});
    // Closing the context is what writes the recording.
    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    const recorded = steps.filter((step): step is Step => step !== null);
    // The recorder reports the page it starts on as a navigation, and startUrl already covers it.
    if (recorded[0] && "goto" in recorded[0] && recorded[0].goto === startUrl) recorded.shift();
    if (passwordProblem) {
      throw new Error(`${passwordProblem} while recording, so nothing was saved. Log in before recording starts, and leave password fields out of a scene.`);
    }
    if (!recorded.some((step) => "shot" in step)) throw new Error("No shots taken, so nothing was saved.");
    if (!existsSync(rawHarPath)) throw new Error("The browser closed before its network log was saved.");

    mkdirSync(sceneDir, { recursive: true });
    const { entries } = scrubHar({
      rawPath: rawHarPath,
      outPath: path.join(sceneDir, "network.har"),
      fromOrigin: origin,
      recordingStarted
    });
    const scene: SceneFile = {
      version: SCENE_VERSION,
      startUrl,
      viewport: config.viewport,
      frozenTime: recordingStarted.toISOString().replace(/\.\d+Z$/, "Z"),
      steps: recorded
    };
    writeFileSync(path.join(sceneDir, "scene.json"), `${JSON.stringify(scene, null, 2)}\n`);
    console.log(`Saved scene ${name}: ${recorded.length} steps, ${entries} API answers.`);
    return name;
  } catch (error) {
    // A scene folder without both files would break every later rerecord.
    rmSync(sceneDir, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(rawDir, { recursive: true, force: true });
  }
};
