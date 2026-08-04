/**
 * A low-frequency, user-directed caller that runs on the owner's workstation, not the Keryx VPS.
 *
 * It has one persistent SIWE identity and uses the sponsored no-session web path. That makes it a
 * genuine external `web` caller without granting an unattended process authority to sign recurring
 * x402 charges. The identity is never rotated: one process is one actor, not a wallet farm.
 *
 * Run under the local PM2 instance with `npm run local-caller`. The private key stays in the
 * ignored `.env.local`; the ignored state file and stdout contain only public identity/scheduling
 * data. Legacy state files are migrated in place without rotating the identity.
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
const ENV_PATH = path.resolve(process.cwd(), ".env.local");
const PRIVATE_KEY_ENV = "KERYX_LOCAL_CALLER_PRIVATE_KEY";
const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");

interface CallerState {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  cursor: number;
  nextRunAt: string;
  createdAt: string;
}

type StoredCallerState = Omit<CallerState, "privateKey"> & {
  privateKey?: `0x${string}`;
};

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
  const { privateKey: _privateKey, ...stored } = state;
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(stored, null, 2), { mode: 0o600 });
}

function isPrivateKey(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
}

function persistPrivateKey(privateKey: `0x${string}`) {
  const current = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  if (new RegExp(`^${PRIVATE_KEY_ENV}=`, "m").test(current)) {
    throw new Error(`${PRIVATE_KEY_ENV} exists in ${ENV_PATH} but was not loaded`);
  }
  const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(ENV_PATH, `${separator}${PRIVATE_KEY_ENV}=${privateKey}\n`, { mode: 0o600 });
  process.env[PRIVATE_KEY_ENV] = privateKey;
}

function loadState(): CallerState {
  const exists = fs.existsSync(STATE_PATH);
  const parsed = exists
    ? (JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as Partial<StoredCallerState>)
    : {};
  const configuredKey = process.env[PRIVATE_KEY_ENV];
  if (configuredKey !== undefined && !isPrivateKey(configuredKey)) {
    throw new Error(`invalid ${PRIVATE_KEY_ENV}; refusing to rotate identity`);
  }
  if (parsed.privateKey !== undefined && !isPrivateKey(parsed.privateKey)) {
    throw new Error(`invalid legacy private key in ${STATE_PATH}; refusing to rotate identity`);
  }
  if (
    configuredKey &&
    parsed.privateKey &&
    configuredKey.toLowerCase() !== parsed.privateKey.toLowerCase()
  ) {
    throw new Error(`legacy state and ${PRIVATE_KEY_ENV} disagree; refusing to rotate identity`);
  }

  let privateKey = configuredKey ?? parsed.privateKey;
  if (!privateKey) {
    if (exists) {
      throw new Error(`missing ${PRIVATE_KEY_ENV}; refusing to rotate existing identity`);
    }
    privateKey = generatePrivateKey();
  }
  if (!configuredKey) {
    persistPrivateKey(privateKey);
  }

  const address = privateKeyToAccount(privateKey).address;
  if (parsed.address && parsed.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`wallet/address mismatch in ${STATE_PATH}; refusing to rotate identity`);
  }
  const state: CallerState = {
    privateKey,
    address,
    cursor: Number.isSafeInteger(parsed.cursor) && Number(parsed.cursor) >= 0 ? Number(parsed.cursor) : 0,
    nextRunAt: parsed.nextRunAt ?? new Date(0).toISOString(),
    createdAt: parsed.createdAt ?? nowLabel(),
  };
  if (!exists || parsed.privateKey) saveState(state);
  return state;
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
