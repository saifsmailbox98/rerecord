// The parts of Playwright's HAR format this package reads, and how a request is identified, which
// scrub (collapsing repeats) and render (serving answers) must agree on.

import { readFileSync } from "node:fs";

export type HarHeader = { name: string; value: string };

export type HarEntry = {
  startedDateTime: string;
  serverIPAddress?: string;
  _serverPort?: number;
  _securityDetails?: unknown;
  request: { method: string; url: string; headers: HarHeader[]; cookies: unknown[]; postData?: { text?: string } };
  response: {
    status: number;
    headers: HarHeader[];
    cookies: unknown[];
    content: { size: number; text?: string; encoding?: string };
  };
};

export type Har = { log: { entries: HarEntry[] } };

export const readHar = (file: string): Har => JSON.parse(readFileSync(file, "utf8"));

export const requestKey = (method: string, url: string, body: string | null | undefined) =>
  `${method} ${url} ${body ?? ""}`;
