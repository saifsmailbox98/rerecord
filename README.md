# rerecord

Docs screenshots that redraw themselves.

> **TL;DR:** rerecord lets you work with docs screenshots as editable text.

One small UI change can leave hundreds of screenshots in your docs out of date at once. Retaking each one means setting up the right data, logins and credentials again, and nobody retakes a thousand screenshots in one sitting. rerecord records each flow in your running app once, then redraws every screenshot from your frontend build whenever you want. It's built on [Playwright](https://playwright.dev), using its recorder, HAR recording and request routing.

<img src="https://cdn.jsdelivr.net/npm/rerecord@0.7.0/assets/card-commands.webp" alt="npx rerecord record records a scene in your running app, run once by whoever builds the feature. npx rerecord rerecord redraws every screenshot from the scenes, run any time by anyone, with only your frontend build" width="880">

## What it solves

### A UI change makes every screenshot stale

A developer changes one class:

<img src="https://cdn.jsdelivr.net/npm/rerecord@0.7.0/assets/card-button.webp" alt="The Create Session button before and after changing rounded-md to rounded-2xl" width="880">

`npx rerecord rerecord` then redraws every screenshot the button appears in:

<img src="https://cdn.jsdelivr.net/npm/rerecord@0.7.0/assets/card-stale.webp" alt="Four screenshots with the old button, and the same four redrawn by npx rerecord rerecord" width="880">

A redraw needs only your frontend build, the recorded steps and the recorded API responses:

<img src="https://cdn.jsdelivr.net/npm/rerecord@0.7.0/assets/card-no-setup.webp" alt="Your frontend build plus the recorded steps and API responses; no backend, no database, no seed data, no shared instance" width="880">

### Set up once, by whoever builds the feature

The developer building a feature already has the backend, data and any outside accounts running on their machine, so they record the screenshots then. After that, a teammate, CI or the same developer a year later can redraw or extend those screenshots without setting anything up, and nobody needs a shared instance:

<img src="https://cdn.jsdelivr.net/npm/rerecord@0.7.0/assets/card-once.webp" alt="The developer building the feature records a scene once; a teammate, CI and the developer a year later redraw it with npx rerecord rerecord" width="880">

### New screenshots need no setup

To add a screen nobody recorded, edit the scene:

<img src="https://cdn.jsdelivr.net/npm/rerecord@0.7.0/assets/card-unrecorded.webp" alt="A dialog that was never recorded, added with two steps and redrawn" width="880">

If a screen needs a paid plan or running services, give it sample data in the recording instead:

<img src="https://cdn.jsdelivr.net/npm/rerecord@0.7.0/assets/card-gated.webp" alt="An empty screen behind a paid plan, redrawn with sample data after editing the recorded API response" width="880">

### Demo data stays clean

Scenes are text, so one find and replace fixes a name or email in every screenshot:

<img src="https://cdn.jsdelivr.net/npm/rerecord@0.7.0/assets/card-data.webp" alt="A keyboard-mash name and email replaced with clean demo data" width="880">

## How it works

A recording is a scene: the steps you took (`scene.json`) and every API response your app received while you took them (`network.har`). A redraw replays the steps against your current build and serves the recorded API responses in place of your backend, so the screenshots show your new code with the recorded data.

## Install

```
npm i -D rerecord
npx playwright install chromium
```

rerecord needs Node 22.18 or newer and an app that renders in the browser from a static build. It's built and tested on Vite single-page apps, and other static builds should work the same way.

## Configure

Create `rerecord.config.ts` (or `rerecord.config.mts` if your package.json has no `"type": "module"`):

```ts
import { defineConfig } from "rerecord";

export default defineConfig({
  appUrl: "http://localhost:5173",
  build: { command: ["npm", "run", "build"], dist: "dist" },
  outputDir: "docs/images",
  viewport: { width: 1440, height: 900 }
});
```

| Option | Default | What it does |
|---|---|---|
| `appUrl` | (required) | The running app `record` opens |
| `build.dist` | (required) | The static build that a redraw serves |
| `build.command` | none | Builds `dist` before redrawing; leave it out to build yourself |
| `build.cwd` | `.` | Where `build.command` runs |
| `apiPrefix` | `/api/` | Requests with this path prefix are recorded and replayed |
| `scenesDir` | `scenes` | Where scenes are saved |
| `outputDir` | `screenshots` | Where screenshots are written |
| `viewport` | `1440 × 900` | Window size; screenshots are taken at 2x |
| `stubs` | `{}` | Fixed responses for files your server generates at runtime, keyed by path |
| `isReady(url)` | always ready | Recording starts once this returns true, so your login never ends up in a scene |
| `saveSessionOn(url)` | never | Saves the session cookie when this returns true for a response URL, for apps that rotate the cookie |

Paths are relative to the config file. rerecord keeps your saved login in `.rerecord/` next to the config, and that folder has its own `.gitignore`.

## Commands

```
rerecord record [name] [--url <path>]
```

Opens your app in a browser window, logged in with your last session if it's still valid. Go through the flow in your app. Press **📸 Shot** for a screenshot, or **⏱ 5s** to get five seconds to hover something first, such as a tooltip or a menu. When you close the window or press Ctrl+C, rerecord saves the scene, builds the app and draws the screenshots.

```
rerecord rerecord [name...] [--no-build]
```

Redraws every scene, or only the named ones, with your current build. It records nothing and needs no app or backend. If the app now makes an API call that the scene never recorded, rerecord stops and names the call. Edit the scene's `network.har`, or record the scene again.

Both commands take `--config <file>`, or read `RERECORD_CONFIG`.

## What gets saved

Before it saves a recording, rerecord:

- drops everything from before recording started, including your login
- removes cookies and `Authorization` headers
- refuses to save if a password is typed into the page or sent in a request, and warns you as soon as that happens

Everything else is saved exactly as your app received it: names, emails, IDs and any secret values your API returns. Record on an instance with fake data, because what you record is what gets committed.

## Limits

- Server-rendered pages: rerecord serves API responses in the browser, so it can't replay data that a server fetches before it sends the HTML
- WebSocket and server-sent event streams aren't recorded
- Iframes, popups and file uploads aren't replayed
- `record` reaches Playwright's recorder through an API that Playwright doesn't publish, so rerecord pins an exact Playwright version
- If you save something while recording, it's saved in your running app

## License

MIT
