/**
 * External x402 marketplace discovery.
 *
 * Keryx doesn't only read its own registered creators — it can probe the LIVE open x402 service
 * bazaar (Circle's `circle services search`) and reason over real third-party endpoints during a
 * query. One CLI call snapshots the whole marketplace (cached); each query then ranks it locally by
 * topical relevance and surfaces the best matches as candidates.
 *
 * These endpoints settle on other chains (Base/ETH/… mainnet), not Keryx's Arc testnet rail, so they
 * are DISCOVERY-ONLY: the agent evaluates and logs them, but the orchestrator never purchases them.
 * This module only READS the marketplace; it moves no money.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config";
import type { SourceCandidate } from "../llm";

const pexec = promisify(exec);

/** CAIP-2 eip155 chain ids → human labels. Arc testnet is Keryx's own rail. */
const CHAINS: Record<string, string> = {
  "eip155:1": "Ethereum",
  "eip155:10": "Optimism",
  "eip155:130": "Unichain",
  "eip155:137": "Polygon",
  "eip155:8453": "Base",
  "eip155:84532": "Base Sepolia",
  "eip155:42161": "Arbitrum",
  "eip155:43114": "Avalanche",
  "eip155:5042002": "Arc",
};

export interface ExternalEndpoint {
  resource: string;
  name: string;
  description: string;
  category: string;
  price: number; // USDC per call (min across accepted chains)
  chains: string[]; // human labels
  payTo: string;
  onArc: boolean;
}

interface RawItem {
  resource?: string;
  name?: string;
  provider?: string;
  description?: string;
  category?: string;
  accepts?: { network?: string; payTo?: string; amount?: string }[];
}

// Marketplace snapshot cache — one CLI call serves many queries. Negative results cached briefly so
// a missing/offline `circle` CLI never re-hangs every query.
let snapshot: { at: number; items: ExternalEndpoint[] } | null = null;
const TTL_OK = 30 * 60_000;
const TTL_FAIL = 2 * 60_000;

/** Snapshot the whole live marketplace via the Circle CLI (cached). Returns [] on any failure. */
async function loadMarketplace(): Promise<ExternalEndpoint[]> {
  const now = Date.now();
  if (snapshot && now - snapshot.at < (snapshot.items.length ? TTL_OK : TTL_FAIL)) {
    return snapshot.items;
  }
  let items: ExternalEndpoint[] = [];
  try {
    const { stdout } = await pexec(
      "circle services search --output json --limit 200",
      { timeout: 15_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    const raw = (JSON.parse(stdout)?.data?.items ?? []) as RawItem[];
    items = raw.map(parseItem).filter((e): e is ExternalEndpoint => e !== null);
  } catch {
    items = []; // CLI absent, offline, or timed out — discovery degrades gracefully.
  }
  snapshot = { at: now, items };
  return items;
}

/** Map one raw bazaar item to a normalized endpoint, or null if it lacks a payable resource. */
function parseItem(it: RawItem): ExternalEndpoint | null {
  const resource = it.resource;
  const accepts = it.accepts ?? [];
  if (!resource || accepts.length === 0) return null;

  const prices = accepts
    .map((a) => Number(a.amount) / 1e6)
    .filter((n) => Number.isFinite(n) && n >= 0);
  const networks = [...new Set(accepts.map((a) => a.network).filter(Boolean) as string[])];
  const chains = networks.map((n) => CHAINS[n] ?? n);

  return {
    resource,
    name: it.name || it.provider || deriveName(resource),
    description: it.description || "",
    category: it.category || "",
    price: prices.length ? Math.min(...prices) : 0,
    chains,
    payTo: accepts.find((a) => a.payTo)?.payTo ?? "",
    onArc: networks.includes("eip155:5042002"),
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

/** Embedding cache: text-hash → vector. Avoids repeated API calls across queries. */
const embedCache = new Map<string, Vec>();

function cacheKey(text: string): string {
  // Simple DJB2 hash — fast, no crypto import needed, sufficient for cache keys
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h);
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
    const json = (await res.json()) as { data: { embedding: Vec }[] };
    return json.data?.map((d) => d.embedding) ?? null;
  } catch {
    return null;
  }
}

/** Embed a single text with caching. Returns null on failure. */
async function embedOne(text: string): Promise<Vec | null> {
  const key = cacheKey(text);
  const cached = embedCache.get(key);
  if (cached) return cached;
  const vecs = await embed([text]);
  if (!vecs || vecs.length === 0) return null;
  embedCache.set(key, vecs[0]);
  return vecs[0];
}

/** Cosine similarity between two vectors (0..1). Returns 0 on dimension mismatch. */
function cosine(a: Vec, b: Vec): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
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
    const texts = endpoints.map(endpointText);
    const vecs = await embed(texts);
    if (vecs && vecs.length === endpoints.length) {
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
        `Settles on ${chainStr} — ${e.onArc ? "Arc-compatible" : "NOT on Keryx's Arc testnet rail"}. ` +
        `~$${e.price.toFixed(4)}/call. Discovery-only: evaluated but not purchased on Arc.`,
      tags: ["external", "x402-marketplace", ...(e.category ? [e.category.toLowerCase()] : [])],
      fetchPrice: e.price,
      cached: false,
      preview: `${e.category ? e.category + " · " : ""}${e.resource}`,
      external: { resource: e.resource, chains: e.chains, payTo: e.payTo, onArc: e.onArc },
    } satisfies SourceCandidate;
  });
}
