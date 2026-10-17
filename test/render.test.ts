import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfig, render } from "../src/index.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const config = await loadConfig(path.join(TEST_DIR, "rerecord.config.ts"));

test("replays repeated requests in recorded order", async () => {
  rmSync(config.outputDir, { recursive: true, force: true });
  const [first, second] = await render(config, "ordered");
  assert.ok(existsSync(first) && existsSync(second));
  // The scene waits for "second answer" before its second shot, so the shots can only differ if
  // the second request got the second recorded answer.
  assert.notDeepEqual(readFileSync(first), readFileSync(second));
});

test("fails loudly when the app asks for an answer the scene never recorded", async () => {
  await assert.rejects(render(config, "missing"), /never recorded[\s\S]*GET \/api\/thing/);
});

test("the CLI rerecords every scene and reports the failing one", () => {
  const result = spawnSync(process.execPath, [path.join(TEST_DIR, "../src/cli.ts"), "rerecord"], {
    cwd: TEST_DIR,
    encoding: "utf8"
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /1 of 2 scenes rerecorded/);
  assert.match(result.stderr, /Failed: missing/);
});

test("the CLI explains itself when run with no command", () => {
  const result = spawnSync(process.execPath, [path.join(TEST_DIR, "../src/cli.ts")], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /rerecord record/);
});
