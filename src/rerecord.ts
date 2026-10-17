// Redraws scenes with the current build. Nothing is recorded again and no app or backend is needed:
// the saved scenes are replayed against the new build.

import { buildApp } from "./build.ts";
import type { ResolvedConfig } from "./config.ts";
import { render } from "./render.ts";
import { listScenes } from "./scene.ts";

// Renders every scene (or only `names`), carrying on past failures. Returns the scenes that failed.
export const rerecord = async (
  config: ResolvedConfig,
  { names = [], build = true }: { names?: string[]; build?: boolean } = {}
) => {
  if (build) buildApp(config);
  const scenes = names.length ? names : listScenes(config);
  const failed: string[] = [];
  for (const name of scenes) {
    try {
      const written = await render(config, name);
      console.log(`${name}: ${written.length} screenshots`);
    } catch (error) {
      console.error((error as Error).message);
      failed.push(name);
    }
  }
  console.log(`${scenes.length - failed.length} of ${scenes.length} scenes rerecorded.`);
  return failed;
};
