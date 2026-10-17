# rerecord

Docs screenshots that redraw themselves.

Screenshots in docs go stale the moment the UI changes, and retaking them means setting up the right data, logins and credentials again. rerecord records a flow in your running app once, then redraws its screenshots from your **current build** whenever you like, with no backend, no database and no seed data.

```
npx rerecord record      # click through your app, press 📸 for each screenshot
npx rerecord rerecord    # after any UI change: every screenshot redrawn, no backend
```

## How it works

A recording is a **scene**: the steps you took (`scene.json`) and every API answer your app received while you took them (`network.har`). To redraw, rerecord serves your static build in a headless browser, answers each API call from the recording, replays the steps and takes the screenshots again. Your new code does the drawing; the recorded data fills it in.

Because scenes are text, they live in git next to your docs, show up as diffs in review, and can be edited by hand or by an agent: rename a fake user, add an answer, or create a screen nobody recorded.

## Install

```
npm i -D rerecord
npx playwright install chromium
```

Needs Node 22.18 or newer, and an app that renders in the browser from a static build. It is built and tested on Vite single-page apps; other static builds (Create React App, webpack, Angular, Vue, SvelteKit in SPA mode, Next.js `output: "export"`) should work the same way.

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
| `build.dist` | (required) | The static build render serves |
| `build.command` | none | Builds `dist` before redrawing; leave it out to build yourself |
| `build.cwd` | `.` | Where `build.command` runs |
| `apiPrefix` | `/api/` | Requests with this path prefix are recorded and replayed |
| `scenesDir` | `scenes` | Where scenes are saved |
| `outputDir` | `screenshots` | Where screenshots are written |
| `viewport` | `1440 × 900` | Window size; screenshots are taken at 2x |
| `stubs` | `{}` | Fixed answers for files your server generates at runtime, keyed by path |
| `isReady(url)` | always ready | Recording starts once this returns true, so your login never ends up in a scene |
| `saveSessionOn(url)` | never | Saves the session cookie when such a response arrives, for apps that rotate it |

Paths are relative to the config file. rerecord keeps your saved login in `.rerecord/` next to the config; that folder ignores itself in git.

## Commands

```
rerecord record [name] [--url <path>]
```

Opens your app in a browser window, already logged in from last time if it can be. Click through the flow. Press **📸 Shot** for a screenshot, or **⏱ 5s** to get five seconds to hover something (a tooltip, a menu) first. Close the window or press Ctrl+C: the scene is saved, the app is built and the screenshots are drawn.

```
rerecord rerecord [name...] [--no-build]
```

Redraws every scene, or only the named ones, with your current build. It records nothing and needs no app or backend. If the app now asks for an API answer a scene never recorded, rerecord stops and names the request: edit that scene's `network.har`, or record it again.

Both commands take `--config <file>`, or read `RERECORD_CONFIG`.

## What gets saved

Before a recording is saved, rerecord:

- drops everything from before recording started, including your login
- removes cookies and `Authorization` headers
- pushes JWT expiry to 2100, so a saved login never looks expired on replay
- refuses to save at all if a password is typed into the page or sent in a request while recording, and warns you the moment it happens, so you can stop and record again
- keeps each request's answers in the order they arrived, collapsing identical repeats, so a list shown before and after a save replays correctly

Everything else is saved exactly as your app received it: names, emails, IDs and any secret values your API returns. Record on an instance with fake data, because what you record is what gets committed.

## Replays that hold up

- Steps use Playwright's accessible selectors (role and name, label, placeholder, text).
- Where an element has none of those, the step also stores where you clicked and what was there, and a replay clicks that spot only if the same thing is still there; a moved UI fails loudly and never clicks the wrong thing.
- A click on empty page (to close a menu) replays only if that spot is still empty.
- Every render uses the same viewport, locale (en-US), timezone (UTC), a clock frozen at the time of recording, and no animations, so two runs give identical images.

## Limits

- Server-rendered pages: rerecord answers API calls in the browser, so data a server fetches before sending HTML can't be replayed.
- WebSocket and server-sent event streams aren't recorded.
- Iframes, popups and file uploads aren't replayed.
- Chromium only.
- `record` uses Playwright's recorder (the engine behind `codegen`) through an API Playwright doesn't publish, so rerecord pins an exact Playwright version.
- A step that saves data during recording really saves it on your instance.

## Use it from code

```ts
import { loadConfig, record, rerecord } from "rerecord";

const config = await loadConfig();
await rerecord(config, { names: ["checkout"], build: false });
```

## License

MIT
