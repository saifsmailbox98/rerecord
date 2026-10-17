// Cleans a fresh recording before it is saved: removes cookies and auth headers, points URLs at the
// render address, and keeps each request's answers in order, minus repeats. The data itself is saved
// as recorded.

import { writeFileSync } from "node:fs";

import { escapeRegExp, RENDER_ORIGIN } from "./config.ts";
import type { HarEntry } from "./har.ts";
import { readHar, requestKey } from "./har.ts";

const JWT_RE = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g;
const SECRET_HEADERS = new Set(["cookie", "set-cookie", "authorization"]);
// Scrubbing changes body lengths, and replay would otherwise send the recorded length.
const STALE_HEADERS = new Set(["content-length", "content-encoding"]);
// 2100-01-01, so a token never looks expired to the app whatever the clock says.
const FAR_FUTURE_EXP = 4102444800;

const decodePart = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
const encodePart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

const scrubberFor = (fromOrigin: string) => {
  // The app checks a token's expiry with the real clock, so a saved login would expire on replay.
  // The signature is dropped, since nothing checks it at render.
  const reforgeJwt = (token: string) => {
    const [header, payload] = token.split(".");
    return [header, encodePart({ ...decodePart(payload), exp: FAR_FUTURE_EXP }), "rerecord"].join(".");
  };

  return (text: string) => {
    const out = text.replace(JWT_RE, reforgeJwt).split(fromOrigin).join(RENDER_ORIGIN);
    // Only the bare host itself: api.<host> belongs to another origin the app may also call.
    return out.replace(new RegExp(`(?<![\\w.-])${escapeRegExp(new URL(fromOrigin).host)}`, "g"), new URL(RENDER_ORIGIN).host);
  };
};

// A poll or refetch that got the same answer again adds nothing to replay, so only answers that
// changed are kept. Error answers stay: some screens ("no access", "not found") are built on them.
const collapseRepeats = (entries: HarEntry[]) => {
  const lastAnswer = new Map<string, string>();
  return entries.filter((entry) => {
    const key = requestKey(entry.request.method, entry.request.url, entry.request.postData?.text);
    const answer = `${entry.response.status} ${entry.response.content.text ?? ""}`;
    if (lastAnswer.get(key) === answer) return false;
    lastAnswer.set(key, answer);
    return true;
  });
};

const stripHeaders = (entry: HarEntry) => {
  entry.request.headers = entry.request.headers.filter((h) => !SECRET_HEADERS.has(h.name.toLowerCase()));
  entry.response.headers = entry.response.headers.filter((h) => {
    const name = h.name.toLowerCase();
    return !SECRET_HEADERS.has(name) && !STALE_HEADERS.has(name);
  });
  entry.request.cookies = [];
  entry.response.cookies = [];
  delete entry.serverIPAddress;
  delete entry._serverPort;
  delete entry._securityDetails;
};

// Reads the raw recording from `rawPath` and writes the cleaned one to `outPath`, so the raw file
// can live outside the project and never be committed by accident.
export const scrubHar = ({ rawPath, outPath, fromOrigin }: { rawPath: string; outPath: string; fromOrigin: string }) => {
  const har = readHar(rawPath);
  // A request cut off mid-flight (by a reload or a closed tab) is logged with status -1, or with a
  // status but no body (content size -1); replaying either would hand the app a broken answer.
  const isAnswered = (entry: HarEntry) => entry.response.status >= 100 && entry.response.content.size >= 0;
  const entries = har.log.entries
    .filter(isAnswered)
    .sort((a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime));
  if (entries.some((entry) => /"password"\s*:/.test(entry.request.postData?.text ?? ""))) {
    throw new Error("A request in the recording carries a password, so nothing was saved. Log in before recording starts.");
  }
  har.log.entries = collapseRepeats(entries);
  har.log.entries.forEach(stripHeaders);

  const text = scrubberFor(fromOrigin)(JSON.stringify(har, null, 2));
  writeFileSync(outPath, `${text}\n`);
  return { entries: har.log.entries.length };
};
