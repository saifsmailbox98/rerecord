// What a project imports: defineConfig for its rerecord.config.ts, and the same commands as functions.

export type { Config, ResolvedConfig } from "./config.ts";
export { defineConfig, loadConfig } from "./config.ts";
export { record } from "./record.ts";
export { render } from "./render.ts";
export { rerecord } from "./rerecord.ts";
export type { Point, Scene, SceneFile, Step, Target } from "./scene.ts";
