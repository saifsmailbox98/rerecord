// The scene format (scenes/<name>/scene.json next to network.har) and how to find and load scenes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ResolvedConfig } from "./config.ts";

export type Target =
  | { selector: string }
  | { role: string; name?: string; exact?: boolean }
  | { placeholder: string }
  | { label: string }
  | { text: string; exact?: boolean };

export type Point = { x: number; y: number };

// Where a click landed and a short description of what was there at that moment.
export type Pointer = { at: Point; under: string };

export type Step =
  | { goto: string }
  | { click: Target; at?: Point; under?: string }
  | { fill: Target; value: string; at?: Point; under?: string }
  | { press: string; target?: Target }
  | { waitFor: Target }
  | { selectOption: Target; values: string[] }
  // `shot` is a file name inside the config's outputDir.
  | { shot: string; hover?: Point };

export const SCENE_VERSION = 1;

export type SceneFile = {
  version?: typeof SCENE_VERSION;
  startUrl: string;
  viewport: { width: number; height: number };
  frozenTime: string;
  steps: Step[];
};

export type Scene = SceneFile & { name: string; dir: string };

export const loadScene = (config: ResolvedConfig, name: string): Scene => {
  const dir = path.join(config.scenesDir, name);
  const file = path.join(dir, "scene.json");
  if (!existsSync(file)) throw new Error(`No scene named ${name} in ${config.scenesDir}.`);
  const scene: SceneFile = JSON.parse(readFileSync(file, "utf8"));
  if (scene.version !== undefined && scene.version !== SCENE_VERSION) {
    throw new Error(`Scene ${name} has format version ${scene.version}; this rerecord reads version ${SCENE_VERSION}.`);
  }
  return { ...scene, name, dir };
};

// Every folder under scenesDir holding a scene.json, nested folders included.
export const listScenes = (config: ResolvedConfig) => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isFile() && entry.name === "scene.json") return [path.relative(config.scenesDir, dir)];
      return entry.isDirectory() ? walk(path.join(dir, entry.name)) : [];
    });
  return existsSync(config.scenesDir) ? walk(config.scenesDir).sort() : [];
};
