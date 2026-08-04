/**
 * A low-frequency, user-directed caller that runs on the owner's workstation, not the Keryx VPS.
 *
 * It has one persistent SIWE identity and uses the sponsored no-session web path. That makes it a
 * genuine external `web` caller without granting an unattended process authority to sign recurring
 * x402 charges. The identity is never rotated: one process is one actor, not a wallet farm.
 *
 * Run under the local PM2 instance with `npm run local-caller`. The ignored state file contains the
 * private key; stdout contains only its public address and run summaries.
 */

import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";

const BASE_URL = (process.env.KERYX_LOCAL_CALLER_BASE_URL ?? "https://keryx.cc").replace(
  /\/$/,
  "",
);
const BUDGET_USDC = boundedNumber(process.env.KERYX_LOCAL_CALLER_BUDGET, 0.03, 0.005, 0.05);
const MIN_SLEEP_SECONDS = boundedInteger(
  process.env.KERYX_LOCAL_CALLER_MIN_SLEEP_SECONDS,
  8 * 60 * 60,
  60 * 60,
  7 * 24 * 60 * 60,
);
const MAX_SLEEP_SECONDS = boundedInteger(
  process.env.KERYX_LOCAL_CALLER_MAX_SLEEP_SECONDS,
  12 * 60 * 60,
  MIN_SLEEP_SECONDS,
  7 * 24 * 60 * 60,
);
const STATE_PATH = path.resolve(process.cwd(), "data", "local-caller-state.json");
const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");

interface CallerState {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  cursor: number;
  nextRunAt: string;
  createdAt: string;
}

interface PublicSource {
  id: string;
  name: string;
  rssUrl?: string;
  verified?: boolean;
}

interface SourcePreview {
  name: string;
  preview?: Array<{ title?: string; summary?: string }>;
}

function boundedNumber(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  return Math.round(boundedNumber(raw, fallback, min, max));
}

function nowLabel() {
  return new Date().toISOString();
}

function log(message: string) {
  console.log(`[local-caller ${nowLabel()}] ${message}`);
}

function saveState(state: CallerState) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function loadState(): CallerState {
  if (!fs.existsSync(STATE_PATH)) {
    const privateKey = generatePrivateKey();
    const state: CallerState = {
      privateKey,
      address: privateKeyToAccount(privateKey).address,
      cursor: 0,
      nextRunAt: new Date(0).toISOString(),
      createdAt: nowLabel(),
    };
    saveState(state);
    return state;
  }

  const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as Partial<CallerState>;
  if (!parsed.privateKey || !/^0x[0-9a-f]{64}$/i.test(parsed.privateKey)) {
    throw new Error(`invalid private key in ${STATE_PATH}; refusing to rotate identity`);
  }
  const address = privateKeyToAccount(parsed.privateKey).address;
  if (parsed.address && parsed.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`wallet/address mismatch in ${STATE_PATH}; refusing to rotate identity`);
  }
  return {
    privateKey: parsed.privateKey,
    address,
    cursor: Number.isSafeInteger(parsed.cursor) && Number(parsed.cursor) >= 0 ? Number(parsed.cursor) : 0,
    nextRunAt: parsed.nextRunAt ?? new Date(0).toISOString(),
    createdAt: parsed.createdAt ?? nowLabel(),
  };
}

function nextDelaySeconds() {
  return (
    MIN_SLEEP_SECONDS +
    Math.floor(Math.random() * (MAX_SLEEP_SECONDS - MIN_SLEEP_SECONDS + 1))
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function captureCookies(res: Response, jar: Map<string, string>) {
  for (const cookie of res.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const at = pair.indexOf("=");
    if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function signIn(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const jar = new Map<string, string>();
  const nonceRes = await fetch(`${BASE_URL}/api/auth/nonce`, {
    headers: { "User-Agent": "Keryx-Local-Caller/1" },
  });
  captureCookies(nonceRes, jar);
  if (!nonceRes.ok) throw new Error(`nonce request failed: HTTP ${nonceRes.status}`);
  const { nonce } = (await nonceRes.json()) as { nonce?: string };
  if (!nonce) throw new Error("nonce response did not include a nonce");

  const message = new SiweMessage({
    domain: new URL(BASE_URL).host,
    address: account.address,
    statement: "Sign in to Keryx.",
    uri: BASE_URL,
    version: "1",
    chainId: 5_042_002,
    nonce,
  }).prepareMessage();
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${BASE_URL}/api/auth/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(jar),
      "User-Agent": "Keryx-Local-Caller/1",
    },
    body: JSON.stringify({ message, signature }),
  });
  captureCookies(verifyRes, jar);
  if (!verifyRes.ok) {
    throw new Error(`SIWE verification failed: HTTP ${verifyRes.status} ${await verifyRes.text()}`);
  }
  return jar;
}

function titleQuestion(title: string, sourceName: string) {
  const clean = title.replace(/["\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
  if (!clean) return `What are the latest findings from ${sourceName}?`;
  if (clean.endsWith("?")) return clean;
  return `What are the key findings in "${clean}"?`;
}

async function pickQuestion(cursor: number) {
  const sourcesRes = await fetch(`${BASE_URL}/api/sources`, {
    headers: { "User-Agent": "Keryx-Local-Caller/1" },
  });
  if (!sourcesRes.ok) throw new Error(`source listing failed: HTTP ${sourcesRes.status}`);
  const payload = (await sourcesRes.json()) as { sources?: PublicSource[] };
  const sources = (payload.sources ?? []).filter(
    (source) => source.verified !== false && Boolean(source.rssUrl),
  );
  if (sources.length === 0) {
    return "How do x402 citation payments reward creators used by autonomous agents?";
  }

  // If one publisher is temporarily unavailable, continue through the registry instead of
  // turning a transient preview failure into a process restart.
  for (let offset = 0; offset < sources.length; offset++) {
    const source = sources[(cursor + offset) % sources.length]!;
    const previewRes = await fetch(
      `${BASE_URL}/api/source/${encodeURIComponent(source.id)}/preview`,
      { headers: { "User-Agent": "Keryx-Local-Caller/1" } },
    ).catch(() => null);
    if (!previewRes?.ok) continue;
    const preview = (await previewRes.json()) as SourcePreview;
    const items = (preview.preview ?? []).filter((item) => item.title?.trim());
    if (items.length === 0) continue;
    const item = items[cursor % items.length]!;
    return titleQuestion(item.title!, preview.name || source.name);
  }
  return "How do x402 citation payments reward creators used by autonomous agents?";
}

interface CompletedRun {
  id?: string;
  citations?: unknown[];
  totalToCreators?: number;
  durationMs?: number;
}

async function consumeAsk(res: Response): Promise<CompletedRun> {
  if (!res.ok || !res.body) {
    throw new Error(`/api/ask failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: CompletedRun | undefined;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length > 0) {
        const data = JSON.parse(dataLines.join("\n")) as CompletedRun & { message?: string };
        if (event === "done") completed = data;
        if (event === "error") throw new Error(data.message ?? "Keryx returned an SSE error");
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (!completed) throw new Error("Keryx closed the stream without a completed run");
  return completed;
}

async function runOnce(state: CallerState) {
  const question = await pickQuestion(state.cursor);
  if (dryRun) {
    log(`dry run as ${state.address}: ${question}`);
    return;
  }
  const jar = await signIn(state.privateKey);
  log(`asking as ${state.address} with budget $${BUDGET_USDC.toFixed(3)}: ${question}`);
  const res = await fetch(`${BASE_URL}/api/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(jar),
      "User-Agent": "Keryx-Local-Caller/1",
    },
    body: JSON.stringify({ question, budget: BUDGET_USDC }),
  });
  const run = await consumeAsk(res);
  log(
    `completed ${run.id ?? "unknown"}: ${run.citations?.length ?? 0} citations, ` +
      `$${Number(run.totalToCreators ?? 0).toFixed(6)} to creators, ${run.durationMs ?? "?"}ms`,
  );
}

async function main() {
  const state = loadState();
  log(
    `online as ${state.address}; one stable actor; interval ${MIN_SLEEP_SECONDS}-${MAX_SLEEP_SECONDS}s`,
  );
  if (dryRun) {
    await runOnce(state);
    return;
  }

  for (;;) {
    const live = loadState();
    const waitMs = new Date(live.nextRunAt).getTime() - Date.now();
    if (!once && Number.isFinite(waitMs) && waitMs > 0) {
      log(`sleeping until ${live.nextRunAt}`);
      await sleep(waitMs);
      continue;
    }

    // Schedule before touching the network. If the process crashes, PM2 restarts into the sleep
    // instead of repeatedly spending the server treasury.
    const delay = nextDelaySeconds();
    const scheduled: CallerState = {
      ...live,
      cursor: live.cursor + 1,
      nextRunAt: new Date(Date.now() + delay * 1000).toISOString(),
    };
    saveState(scheduled);
    try {
      await runOnce(live);
    } catch (error) {
      log(`run failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (once) return;
  }
}

await main();
