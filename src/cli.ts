#!/usr/bin/env node
// The rerecord command. Exit codes: 0 done, 1 a scene or recording failed, 2 bad usage or setup.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { buildApp } from "./build.ts";
import { loadConfig } from "./config.ts";
import { record } from "./record.ts";
import { render } from "./render.ts";
import { rerecord } from "./rerecord.ts";

const ALIASES: Record<string, string> = { r: "record", rr: "rerecord" };

const HELP = `rerecord: docs screenshots that redraw themselves

Usage:
  rerecord record [name] [--url <path>]   Record a scene: click through your running app and
                                          press 📸 for each screenshot, then close the window.
                                          Alias: r
  rerecord rerecord [name...] [--no-build]
                                          Redraw every scene (or the named ones) with your current
                                          build. Needs no app or backend. Alias: rr

Options:
  --config <file>   Config file (default: ./rerecord.config.ts, or $RERECORD_CONFIG)
  --url <path>      Page to open when recording (default: /)
  --no-build        Skip build.command and use the build that is already there
  -h, --help        Show this help
  -v, --version     Show the version
`;

const version = () => {
  const packageJson = path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
  return JSON.parse(readFileSync(packageJson, "utf8")).version as string;
};

const fail = (message: string, code: number) => {
  console.error(message);
  process.exit(code);
};

const main = async () => {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        config: { type: "string" },
        url: { type: "string" },
        "no-build": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" }
      }
    });
  } catch (error) {
    return fail(`${(error as Error).message}\n\n${HELP}`, 2);
  }
  const { values, positionals } = parsed;
  const [typed, ...names] = positionals;
  const command = ALIASES[typed] ?? typed;
  if (values.version) return console.log(version());
  if (values.help || !command) return console.log(HELP);

  let config;
  try {
    config = await loadConfig(values.config);
  } catch (error) {
    return fail((error as Error).message, 2);
  }

  if (command === "record") {
    if (names.length > 1) return fail("record takes at most one scene name.", 2);
    const name = await record(config, { name: names[0], url: values.url });
    if (!values["no-build"]) buildApp(config);
    const written = await render(config, name);
    return console.log(`Rendered ${written.length} screenshots into ${config.outputDir}`);
  }
  if (command === "rerecord") {
    const failed = await rerecord(config, { names, build: !values["no-build"] });
    if (failed.length) fail(`Failed: ${failed.join(", ")}. Edit their network.har or record them again.`, 1);
    return undefined;
  }
  return fail(`Unknown command: ${command}\n\n${HELP}`, 2);
};

main().catch((error: Error) => fail(error.message, 1));
