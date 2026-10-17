// Builds the static app render draws from. The record window shows the live dev server, so rendering
// right after recording has to build first or it draws an older UI.

import { execFileSync } from "node:child_process";

import type { ResolvedConfig } from "./config.ts";

export const buildApp = (config: ResolvedConfig) => {
  if (!config.build.command?.length) return;
  console.log(`Building the app (${config.build.command.join(" ")})...`);
  const [command, ...args] = config.build.command;
  execFileSync(command, args, { cwd: config.build.cwd, stdio: "inherit" });
};
