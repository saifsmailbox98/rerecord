import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { HarEntry } from "../src/har.ts";
import { scrubHar } from "../src/scrub.ts";

const APP = "https://app.test";
const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = [base64url({ alg: "HS256" }), base64url({ email: "real.user@corp.test", exp: 1 }), "realsignature"].join(".");

const entry = (at: string, url: string, status: number, text: string, extra: Partial<HarEntry["request"]> = {}): HarEntry => ({
  startedDateTime: at,
  request: { method: "GET", url, headers: [{ name: "Cookie", value: "session=secret" }], cookies: [{}], ...extra },
  response: {
    status,
    headers: [
      { name: "Set-Cookie", value: "session=rotated" },
      { name: "Content-Length", value: "123" },
      { name: "Content-Type", value: "application/json" }
    ],
    cookies: [{}],
    content: { size: status < 0 ? -1 : text.length, text }
  }
});

const scrub = (entries: HarEntry[]) => {
  const dir = mkdtempSync(path.join(tmpdir(), "scrub-test-"));
  writeFileSync(path.join(dir, "raw.har"), JSON.stringify({ log: { entries } }));
  scrubHar({ rawPath: path.join(dir, "raw.har"), outPath: path.join(dir, "out.har"), fromOrigin: APP });
  return JSON.parse(readFileSync(path.join(dir, "out.har"), "utf8")).log.entries as HarEntry[];
};

test("keeps answered requests in order, minus credentials and repeats", () => {
  const me = `${APP}/api/me`;
  const body = JSON.stringify({ email: "real.user@corp.test", token: jwt, docs: `${APP}/settings`, api: "https://api.app.test/v1" });
  const changed = JSON.stringify({ email: "real.user@corp.test", plan: "pro" });
  const entries = scrub([
    entry("2026-01-15T09:00:01Z", me, 200, body),
    entry("2026-01-15T09:00:02Z", me, 200, body),
    entry("2026-01-15T09:00:03Z", me, 200, changed),
    entry("2026-01-15T09:00:04Z", `${APP}/api/cut-off`, -1, "")
  ]);

  assert.deepEqual(
    entries.map((e) => e.request.url),
    ["http://localhost:39999/api/me", "http://localhost:39999/api/me"]
  );
  const [first, second] = entries;
  // The data is saved as recorded; only credentials and addresses change.
  assert.match(first.response.content.text ?? "", /real\.user@corp\.test/);
  assert.match(second.response.content.text ?? "", /"plan":"pro"/);

  const text = JSON.parse(first.response.content.text ?? "{}");
  assert.equal(text.docs, "http://localhost:39999/settings");
  assert.equal(text.api, "https://api.app.test/v1");
  const claims = JSON.parse(Buffer.from(text.token.split(".")[1], "base64url").toString());
  assert.equal(claims.exp, 4102444800);
  assert.equal(claims.email, "real.user@corp.test");

  const headerNames = entries.flatMap((e) => [...e.request.headers, ...e.response.headers]).map((h) => h.name.toLowerCase());
  assert.deepEqual([...new Set(headerNames)], ["content-type"]);
  assert.ok(entries.every((e) => e.request.cookies.length === 0 && e.response.cookies.length === 0));
});

test("refuses to save a recording that sends a password", () => {
  assert.throws(
    () =>
      scrub([
        entry("2026-01-15T09:00:01Z", `${APP}/api/users`, 200, "{}", {
          method: "POST",
          postData: { text: '{"email":"a@b.test","password":"hunter2"}' }
        })
      ]),
    /carries a password/
  );
});
