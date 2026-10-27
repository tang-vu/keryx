/**
 * External x402 marketplace discovery.
 *
 * Keryx doesn't only read its own registered creators — it can probe the LIVE open x402 service
 * bazaar (Circle's `circle services search`) and reason over real third-party endpoints during a
 * query. One CLI call takes a bounded cached snapshot; each query then ranks it locally by
 * topical relevance and surfaces the best matches as candidates.
 *
 * Endpoints advertise acceptance on various chains, which may include the selected Arc profile.
 * All are DISCOVERY-ONLY: the agent evaluates and logs them, but never purchases them. Marketplace
 * metadata alone does not establish trusted payment authority or settlement.
 * This module only READS the marketplace; it moves no money.
 */

import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config";
import type { SourceCandidate } from "../llm";

const pexec = promisify(exec);

/** CAIP-2 eip155 chain ids → human labels; retain each advertised network's identity. */
const CHAINS: Record<string, string> = {
  "eip155:1": "Ethereum",
  "eip155:10": "Optimism",
  "eip155:130": "Unichain",
  "eip155:137": "Polygon",
  "eip155:8453": "Base",
  "eip155:84532": "Base Sepolia",
  "eip155:42161": "Arbitrum",
  "eip155:43114": "Avalanche",
  "eip155:5042": "Arc mainnet",
  "eip155:5042002": "Arc testnet",
};

export interface ExternalEndpoint {
  resource: string;
  name: string;
  description: string;
  category: string;
  price: number; // minimum admitted USDC quote; metadata only, never payment authority
  chains: string[]; // human labels
  payTo: string;
  onArc: boolean; // advertises acceptance on the trusted selected Arc profile; not purchase authority
}

// Local admission caps, not vendor or payment limits. Oversize fields/offers are
// refused intact, so an omitted offer cannot silently change an advertised price.
const MAX_MARKETPLACE_ITEMS = 200;
const MAX_ACCEPTS_PER_ITEM = 64;

// Marketplace snapshot cache — one CLI call serves many queries. Negative results cached briefly so
// a missing/offline `circle` CLI never re-hangs every query.
let snapshot: { at: number; items: ExternalEndpoint[] } | null = null;
let loadingMarketplace: Promise<ExternalEndpoint[]> | null = null;
const TTL_OK = 30 * 60_000;
const TTL_FAIL = 2 * 60_000;

/** Snapshot at most 200 marketplace rows. Whole-response failures return []. */
async function loadMarketplace(): Promise<ExternalEndpoint[]> {
  const now = Date.now();
  if (snapshot && now - snapshot.at < (snapshot.items.length ? TTL_OK : TTL_FAIL)) {
    return snapshot.items;
  }
  if (loadingMarketplace) return loadingMarketplace;
  loadingMarketplace = (async () => {
    let items: ExternalEndpoint[] = [];
    try {
      const { stdout } = await pexec(
        "circle services search --output json --limit 200",
        { timeout: 15_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      );
      const response: unknown = JSON.parse(stdout);
      const raw = record(response) && record(response.data) ? response.data.items : undefined;
      if (Array.isArray(raw)) items = raw.slice(0, MAX_MARKETPLACE_ITEMS).map(parseItem)
        .filter((e): e is ExternalEndpoint => e !== null);
    } catch {
      items = []; // CLI absent, offline, or timed out — discovery degrades gracefully.
    }
    snapshot = { at: Date.now(), items };
    return items;
  })();
  try {
    return await loadingMarketplace;
  } finally {
    loadingMarketplace = null;
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function optionalText(value: unknown, maximum: number, multiline = false): boolean {
  if (value === undefined || value === null) return true;
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u : /[\u0000-\u001f\u007f-\u009f]/u;
  return typeof value === "string" && value.length <= maximum && !controls.test(value);
}

function resourceUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 4096 || /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

/** Unknown or inexact quotes stay unknown. An explicit exact zero remains zero. */
function advertisedPrice(amount: unknown): number | null {
  const micros = typeof amount === "number" ? amount : typeof amount === "string" && amount.length <= 32 && /^[0-9]+$/u.test(amount)
    ? Number(amount) : NaN;
  if (!Number.isSafeInteger(micros) || micros < 0) return null;
  const price = micros / 1_000_000;
  if (Math.round(price * 1_000_000) !== micros) return null;
  // Binary multiplication can round back to the original integer while decimal
  // rendering differs by a micro. The advertised six-digit quote must agree too.
  if (BigInt(price.toFixed(6).replace(".", "")) !== BigInt(micros)) return null;
  return price === 0 ? 0 : price;
}

/** Admit plain bounded HTTP metadata per listing/offer; it never grants purchase authority. */
function parseItem(it: unknown): ExternalEndpoint | null {
  if (!record(it)) return null;
  const resource = it.resource;
  if (!resourceUrl(resource) || !optionalText(it.name, 256) || !optionalText(it.provider, 256) ||
    !optionalText(it.description, 8192, true) || !optionalText(it.category, 128) ||
    !Array.isArray(it.accepts) || !it.accepts.length || it.accepts.length > MAX_ACCEPTS_PER_ITEM) return null;
  const accepts: Array<{ price: number; network: string; payTo: string }> = [];
  for (const offer of it.accepts) {
    if (!record(offer) || !optionalText(offer.network, 128) || !optionalText(offer.payTo, 256)) continue;
    const price = advertisedPrice(offer.amount);
    if (price === null) continue;
    accepts.push({ price, network: typeof offer.network === "string" ? offer.network : "",
      payTo: typeof offer.payTo === "string" ? offer.payTo : "" });
  }
  if (!accepts.length) return null;
  const networks = [...new Set(accepts.map(a => a.network).filter(Boolean))];
  const chains = networks.map(n => Object.hasOwn(CHAINS, n) ? CHAINS[n]! : n);

  return {
    resource,
    name: (typeof it.name === "string" ? it.name : "") || (typeof it.provider === "string" ? it.provider : "") || deriveName(resource),
    description: typeof it.description === "string" ? it.description : "",
    category: typeof it.category === "string" ? it.category : "",
    price: Math.min(...accepts.map(a => a.price)),
    chains,
    payTo: accepts.find((a) => a.payTo)?.payTo ?? "",
    onArc: networks.includes(config.networkId),
  };
}

/** Human name from a URL: host (minus api./www.) + last meaningful path segment. */
function deriveName(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(api|www)\./, "");
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return seg ? `${host} · ${seg}` : host;
  } catch {
    return url;
  }
}

const STOP = new Set(
  "the a an and or but of to in on for with at by from is are was were be been this that what which who how why when where do does did can could should would will your you it its as into about more most than then how".split(
    /\s+/,
  ),
);

function tokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

// ── Embedding-based semantic scoring ──

type Vec = number[];

/** Bounded question LRU; retain neither question text nor a growing history of vectors. */
const MAX_QUESTION_EMBEDDINGS = 128;
const embedCache = new Map<string, Vec>();
const pendingEmbeddings = new Map<string, Promise<Vec | null>>();
/** A refreshed snapshot gets new vectors; obsolete snapshots can be garbage-collected. */
const snapshotEmbeddings = new WeakMap<ExternalEndpoint[], Promise<Vec[] | null>>();

function cacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Call an OpenAI-compatible /embeddings endpoint. Returns the vector or null on failure. */
async function embed(texts: string[]): Promise<Vec[] | null> {
  if (!config.embeddingApiKey) return null;
  try {
    const res = await fetch(`${config.embeddingBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.embeddingApiKey}`,
      },
      body: JSON.stringify({ model: config.embeddingModel, input: texts }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { embedding?: unknown; index?: unknown }[] } | null;
    if (!Array.isArray(json?.data) || json.data.length !== texts.length) return null;
    const vecs = json.data.map(d => d?.embedding);
    if (!vecs.every((v): v is Vec => Array.isArray(v) && v.length > 0 &&
      v.every(n => typeof n === "number" && Number.isFinite(n)))) return null;
    // Legacy compatible providers may omit every index and return input order.
    // Once any row declares an index, require a complete one-to-one mapping.
    if (!json.data.some(row => row?.index !== undefined)) return vecs;
    const ordered = new Array<Vec>(texts.length);
    const seen = new Set<number>();
    for (const [offset, row] of json.data.entries()) {
      const index = row?.index;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 ||
        index >= texts.length || seen.has(index)) return null;
      seen.add(index);
      ordered[index] = vecs[offset];
    }
    return ordered;
  } catch {
    return null;
  }
}

/** Embed a single text with caching. Returns null on failure. */
async function embedOne(text: string): Promise<Vec | null> {
  const key = cacheKey(text);
  const cached = embedCache.get(key);
  if (cached) {
    embedCache.delete(key);
    embedCache.set(key, cached);
    return cached;
  }
  const pending = pendingEmbeddings.get(key);
  if (pending) return pending;
  const request = (async () => {
    const vecs = await embed([text]);
    if (!vecs) return null;
    embedCache.set(key, vecs[0]);
    if (embedCache.size > MAX_QUESTION_EMBEDDINGS) embedCache.delete(embedCache.keys().next().value!);
    return vecs[0];
  })();
  pendingEmbeddings.set(key, request);
  try {
    return await request;
  } finally {
    pendingEmbeddings.delete(key);
  }
}

/** Cosine similarity (-1..1); zero/mismatched vectors retain the zero-score convention. */
function cosine(a: Vec, b: Vec): number {
  if (a.length !== b.length) return 0;
  // Embeddings are finite, but providers need not normalize them. Scaling each
  // vector first preserves its direction without squaring huge/tiny components.
  let scaleA = 0, scaleB = 0;
  for (let i = 0; i < a.length; i++) {
    scaleA = Math.max(scaleA, Math.abs(a[i]));
    scaleB = Math.max(scaleB, Math.abs(b[i]));
  }
  if (scaleA === 0 || scaleB === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] / scaleA, y = b[i] / scaleB;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return Math.max(-1, Math.min(1, dot / denom));
}

/** Keyword-overlap score (fallback when embeddings unavailable). */
function keywordScore(q: Set<string>, e: ExternalEndpoint): number {
  if (q.size === 0) return 0;
  const doc = tokens(`${e.name} ${e.description} ${e.category} ${e.resource}`);
  let hits = 0;
  for (const t of q) if (doc.has(t)) hits++;
  return hits / q.size;
}

/** Text representation of an endpoint for embedding. */
function endpointText(e: ExternalEndpoint): string {
  return `${e.name}. ${e.description} ${e.category} ${e.resource}`;
}

/** Share only this snapshot's embedding work. Failed requests remain retryable. */
async function embedSnapshot(endpoints: ExternalEndpoint[]): Promise<Vec[] | null> {
  const cached = snapshotEmbeddings.get(endpoints);
  if (cached) return cached;
  const request = embed(endpoints.map(endpointText));
  snapshotEmbeddings.set(endpoints, request);
  const vecs = await request;
  if (!vecs) snapshotEmbeddings.delete(endpoints);
  return vecs;
}

/**
 * Score all endpoints against a question. Uses embedding cosine similarity when an embedding
 * API is configured and reachable; falls back to keyword-overlap otherwise.
 */
async function scoreEndpoints(
  question: string,
  endpoints: ExternalEndpoint[],
): Promise<{ e: ExternalEndpoint; s: number; method: "semantic" | "keyword" }[]> {
  // Try semantic scoring first
  const qVec = await embedOne(question);
  if (qVec) {
    const vecs = await embedSnapshot(endpoints);
    if (vecs && vecs.every(v => v.length === qVec.length)) {
      return endpoints.map((e, i) => ({
        e,
        s: cosine(qVec, vecs[i]),
        method: "semantic" as const,
      }));
    }
  }
  // Fallback to keyword-overlap
  const q = tokens(question);
  return endpoints.map((e) => ({ e, s: keywordScore(q, e), method: "keyword" as const }));
}

/**
 * Probe the live marketplace for endpoints relevant to a question and return them as candidates
 * (id prefixed `ext:`). Discovery-only — these are never purchased. Returns [] when disabled,
 * unavailable, or nothing is relevant. Uses semantic (embedding) scoring when available,
 * keyword-overlap otherwise.
 */
export async function discoverExternalCandidates(
  question: string,
  subClaims: string[],
  limit = config.externalDiscoveryLimit,
): Promise<SourceCandidate[]> {
  if (!config.externalDiscovery) return [];
  const all = await loadMarketplace();
  if (all.length === 0) return [];

  const queryText = `${question} ${subClaims.join(" ")}`;
  const scored = await scoreEndpoints(queryText, all);
  const method = scored[0]?.method ?? "keyword";

  const ranked = scored
    .sort((a, b) => b.s - a.s)
    .filter((r) => r.s > (method === "semantic" ? 0.1 : 0)) // semantic uses lower threshold (cosine)
    .slice(0, limit);

  return ranked.map(({ e, s }) => {
    const chainStr = e.chains.join(", ") || "another chain";
    return {
      id: `ext:${e.resource}`,
      name: e.name,
      description:
        `[Live x402 marketplace · ${method === "semantic" ? `semantic match ${Math.round(s * 100)}%` : `keyword match`}] ` +
        `${e.description || e.category || "External paid API"}. ` +
        `Advertises payment acceptance on ${chainStr} — ${e.onArc ? "includes Keryx's selected network" : "does not include Keryx's selected network"}. ` +
        `~$${e.price.toFixed(6)}/call. Discovery-only: evaluated but never purchased by Keryx.`,
      tags: ["external", "x402-marketplace", ...(e.category ? [e.category.toLowerCase()] : [])],
      fetchPrice: e.price,
      cached: false,
      preview: `${e.category ? e.category + " · " : ""}${e.resource}`,
      external: { resource: e.resource, chains: e.chains, payTo: e.payTo, onArc: e.onArc },
    } satisfies SourceCandidate;
  });
}
