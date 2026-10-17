// The config a project writes (rerecord.config.ts), its defaults, and loading it. Paths in a config
// are relative to the config file.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type Config = {
  // The running app that `record` opens.
  appUrl: string;
  // Requests whose path starts with this are recorded, and answered from the recording at render.
  apiPrefix?: string;
  scenesDir?: string;
  outputDir?: string;
  // The static build render serves, with no backend. `command` builds it; leave it out to build yourself.
  build: { command?: string[]; cwd?: string; dist: string };
  viewport?: { width: number; height: number };
  // Fixed answers at render for files a server generates at runtime, keyed by URL path.
  stubs?: Record<string, { contentType: string; body: string }>;
  // Recording starts once this is true for the page URL, so a login never ends up in a scene.
  isReady?: (url: URL) => boolean;
  // Saves the session cookie whenever such a response arrives, for apps that rotate it.
  saveSessionOn?: (responseUrl: string) => boolean;
  // Every email in a recording becomes this, except ones already on example.com.
  fakeEmail?: string;
};

export const defineConfig = (config: Config) => config;

export type ResolvedConfig = Required<Omit<Config, "build">> & {
  build: { command?: string[]; cwd: string; dist: string };
  // Gitignored local state: the saved login and private scrub replacements.
  stateDir: string;
};

const CONFIG_NAMES = ["rerecord.config.ts", "rerecord.config.mts", "rerecord.config.js", "rerecord.config.mjs"];

const findConfigFile = (explicit?: string) => {
  const chosen = explicit ?? process.env.RERECORD_CONFIG;
  if (chosen) return path.resolve(chosen);
  const found = CONFIG_NAMES.map((name) => path.resolve(name)).find((file) => existsSync(file));
  if (!found) throw new Error(`No ${CONFIG_NAMES[0]} in ${process.cwd()}. Create one, or pass --config <file>.`);
  return found;
};

export const loadConfig = async (file?: string): Promise<ResolvedConfig> => {
  const configFile = findConfigFile(file);
  const dir = path.dirname(configFile);
  let loaded: Config;
  try {
    loaded = (await import(pathToFileURL(configFile).href)).default;
  } catch (error) {
    // A .ts file follows the nearest package.json "type", so in a CommonJS project its imports fail.
    if (/Cannot use import statement outside a module/.test((error as Error).message)) {
      throw new Error(`${configFile} was loaded as CommonJS. Rename it to rerecord.config.mts, or add "type": "module" to package.json.`);
    }
    throw error;
  }
  const fromConfigDir = (relative: string) => path.resolve(dir, relative);
  return {
    appUrl: loaded.appUrl.replace(/\/$/, ""),
    apiPrefix: loaded.apiPrefix ?? "/api/",
    scenesDir: fromConfigDir(loaded.scenesDir ?? "scenes"),
    outputDir: fromConfigDir(loaded.outputDir ?? "screenshots"),
    build: {
      command: loaded.build.command,
      cwd: fromConfigDir(loaded.build.cwd ?? "."),
      dist: fromConfigDir(loaded.build.dist)
    },
    viewport: loaded.viewport ?? { width: 1440, height: 900 },
    stubs: loaded.stubs ?? {},
    isReady: loaded.isReady ?? (() => true),
    saveSessionOn: loaded.saveSessionOn ?? (() => false),
    fakeEmail: loaded.fakeEmail ?? "jane@example.com",
    stateDir: path.join(dir, ".rerecord")
  };
};

// Creates the state folder with a .gitignore of its own, so nobody has to remember to ignore it.
export const ensureStateDir = (config: ResolvedConfig) => {
  mkdirSync(config.stateDir, { recursive: true });
  const ignore = path.join(config.stateDir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  return config.stateDir;
};

// Nothing listens here; render answers every request with routes. It has to be localhost so the
// page is a secure context like a real https app.
export const RENDER_ORIGIN = "http://localhost:39999";

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
