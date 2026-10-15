import {
  PRIVATE_JOB_HISTORY_BOUNDS as B, comparePrivateJobPosition, privateJobTime,
  parsePrivateJobHistoryInput, privateJobHistoryDetailInputSchema,
  privateJobHistoryPageSchema, privateJobHistoryDetailSchema, privateJobHistoryExportSchema,
  type PrivateJobHistoryInput, type PrivateJobHistoryRow, type PrivateJobHistoryPage,
  type PrivateJobHistoryDetail, type PrivateJobHistoryExport,
} from "./private-job-history-contract";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";

export const PRIVATE_JOB_HISTORY_ORIGIN = "https://keryx.cc";
export const PRIVATE_JOB_HISTORY_REFUSAL = "Private job history refused or unavailable.";
const refuse = () => new Error(PRIVATE_JOB_HISTORY_REFUSAL);
const encoder = new TextEncoder();
const ownerPattern = /^0x[a-f0-9]{40}$/;
const tokenPattern = /^kx_live_[a-f0-9]{96}$/;
const cursorPattern = /^[A-Za-z0-9_-]{1,2000}$/;

/** Bound plain data before Zod/serialization, without invoking getters or toJSON.
 * Unlike the small-input portable copier, this permits the existing 500-row export.
 * This is a transport guard; all domain schemas remain the shared contract above. */
function portable(raw: unknown, maxBytes: number): unknown {
  let entries = 0, size = 0;
  const ancestors = new Set<object>();
  const add = (text: string) => { size += encoder.encode(text).byteLength; if (size > maxBytes) throw refuse(); };
  const copy = (value: unknown, depth: number): unknown => {
    if (++entries > 200_000 || depth > 16) throw refuse();
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
      add(JSON.stringify(value)); return value;
    }
    if (typeof value === "string") {
      if (value.length > maxBytes || !isWellFormedUtf16(value)) throw refuse();
      add(JSON.stringify(value)); return value;
    }
    if (!value || typeof value !== "object" || ancestors.has(value)) throw refuse();
    ancestors.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
      if (value.length > 512 || Reflect.ownKeys(value).length !== value.length + 1) throw refuse();
      add("[]");
      result = Array.from({ length: value.length }, (_, index) => {
        const field = Object.getOwnPropertyDescriptor(value, String(index));
        if (!field || !("value" in field)) throw refuse();
        if (index) add(","); return copy(field.value, depth + 1);
      });
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw refuse();
      const keys = Reflect.ownKeys(value);
      if (keys.length > 64 || keys.some(key => typeof key !== "string")) throw refuse();
      const object: Record<string, unknown> = Object.create(null); add("{}");
      for (const [index, key] of (keys as string[]).entries()) {
        if (key.length > 4096 || !isWellFormedUtf16(key)) throw refuse();
        const field = Object.getOwnPropertyDescriptor(value, key)!;
        if (!("value" in field) || !field.enumerable) throw refuse();
        if (index) add(","); add(JSON.stringify(key)); add(":");
        Object.defineProperty(object, key, { value: copy(field.value, depth + 1), enumerable: true });
      }
      result = object;
    }
    ancestors.delete(value); return result;
  };
  return copy(raw, 0);
}
function wallet(value: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw refuse();
  return value.toLowerCase();
}
function rows(values: PrivateJobHistoryRow[], input: PrivateJobHistoryInput) {
  const seen = new Set<string>();
  let previous: { id: string; createdAt: string } | undefined;
  for (const row of values) {
    if (!row.intentCreatedAt || seen.has(row.id)) throw refuse();
    const position = { id: row.id, createdAt: row.intentCreatedAt };
    if (previous && comparePrivateJobPosition(position, previous) >= 0
      || input.search !== undefined && !row.question.includes(input.search)
      || input.surface && (row.provenance?.surface ?? "unknown") !== input.surface
      || input.network && row.incomingSettlement.network !== input.network
      || input.from && privateJobTime(position.createdAt) < privateJobTime(input.from)
      || input.to && privateJobTime(position.createdAt) > privateJobTime(input.to)) throw refuse();
    seen.add(row.id); previous = position;
  }
}
function continuation(next: string | null, input: PrivateJobHistoryInput) {
  if (next !== null && (!cursorPattern.test(next) || next === input.cursor)) throw refuse();
}
function owner(actual: string, expected?: string) {
  if (!ownerPattern.test(actual) || expected !== undefined && actual !== wallet(expected)) throw refuse();
}
export function guardPrivateJobHistoryPage(raw: unknown, rawInput: PrivateJobHistoryInput = {}, expected?: string): PrivateJobHistoryPage {
  const input = parsePrivateJobHistoryInput(rawInput);
  const value = privateJobHistoryPageSchema.parse(portable(raw, B.pageBytes));
  owner(value.wallet, expected); rows(value.rows, input); continuation(value.nextCursor, input);
  if (value.rows.length > input.limit || value.rows.length > value.scannedIntents
    || value.scanLimited !== (value.nextCursor !== null && value.rows.length < input.limit)
    || value.nextCursor !== null && value.scannedIntents === 0) throw refuse();
  return value;
}
export function guardPrivateJobHistoryDetail(raw: unknown, id: string, expected?: string): PrivateJobHistoryDetail {
  privateJobHistoryDetailInputSchema.parse({ id });
  const value = privateJobHistoryDetailSchema.parse(portable(raw, B.detailBytes));
  owner(value.wallet, expected);
  if (value.row.id !== id || value.row.intentCreatedAt !== null
    || value.result.decisions.some(item => item.targets.some(index => index >= value.result.subClaims.length))
    || [...(value.result.evidence ?? []), ...(value.result.claimCoverage ?? [])]
      .some(item => value.result.subClaims[item.claimIndex] !== item.claim)) throw refuse();
  return value;
}
export function guardPrivateJobHistoryExport(raw: unknown, rawInput: PrivateJobHistoryInput = {}, expected?: string): PrivateJobHistoryExport {
  const input = parsePrivateJobHistoryInput(rawInput);
  const value = privateJobHistoryExportSchema.parse(portable(raw, B.exportBytes));
  owner(value.wallet, expected); rows(value.rows, input); continuation(value.nextCursor, input);
  if (value.rows.length > value.pages * input.limit) throw refuse();
  return value;
}

export interface PrivateJobHistoryClientOptions { expectedWallet?: string; signal?: AbortSignal }
export interface PrivateJobHistoryClient {
  current(): void;
  list(input?: PrivateJobHistoryInput, options?: PrivateJobHistoryClientOptions): Promise<PrivateJobHistoryPage>;
  detail(input: { id: string }, options?: PrivateJobHistoryClientOptions): Promise<PrivateJobHistoryDetail>;
  export(input?: PrivateJobHistoryInput, options?: PrivateJobHistoryClientOptions): Promise<PrivateJobHistoryExport>;
}

/** Exact existing POST contracts. The server alone authenticates the key and enforces
 * history:read. Expected wallet is only a mismatch precondition. No configured wallet
 * is treated as key ownership. One client lifetime binds the first key and server owner. */
export function createPrivateJobHistoryClient(origin: string, key: () => string | undefined,
  fetcher: typeof fetch = fetch): PrivateJobHistoryClient {
  let base: URL;
  try {
    base = new URL(origin);
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw refuse();
  } catch { throw refuse(); }
  let lifetimeKey: string | undefined, lifetimeOwner: string | undefined;
  async function request<T extends { wallet: string }>(path: string, input: unknown, maxBytes: number,
    maxMs: number, options: PrivateJobHistoryClientOptions, guard: (raw: unknown, expected?: string) => T): Promise<T> {
    if (options.signal?.aborted) throw refuse();
    const controller = new AbortController(), cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const deadline = Date.now() + maxMs;
    let rejectStop!: (error: Error) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    void stopped.catch(() => undefined);
    const stop = () => rejectStop(refuse());
    controller.signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(cancel, maxMs);
    let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const token = key();
      if (!token || !tokenPattern.test(token) || lifetimeKey !== undefined && token !== lifetimeKey) throw refuse();
      lifetimeKey ??= token;
      const expected = options.expectedWallet === undefined ? lifetimeOwner : wallet(options.expectedWallet);
      if (lifetimeOwner && expected !== lifetimeOwner) throw refuse();
      const check = () => { if (controller.signal.aborted || Date.now() >= deadline || key() !== token) throw refuse(); };
      const read = async <V>(fn: () => Promise<V>): Promise<V> => {
        check();
        const result = await Promise.race([Promise.resolve().then(() => { check(); return fn(); }), stopped]);
        check(); return result;
      };
      check();
      const body = JSON.stringify(input);
      if (encoder.encode(body).byteLength > B.requestBytes) throw refuse();
      const pending = Promise.resolve().then(() => {
        check(); return fetcher(new URL(path, base), { method: "POST", body,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json",
            ...(expected ? { "x-keryx-expected-wallet": expected } : {}) },
          credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal });
      });
      // Cancel a late transport even if an injected transport ignores AbortSignal.
      void pending.then(value => {
        try { if (controller.signal.aborted || key() !== token) void value.body?.cancel().catch(() => undefined); }
        catch { void value.body?.cancel().catch(() => undefined); }
      }, () => undefined);
      response = await read(() => pending);
      if (!response.ok || response.redirected || response.url && response.url !== new URL(path, base).href
        || !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(response.headers.get("content-type") ?? "")
        || !response.body) throw refuse();
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d{1,10}$/.test(declared) || Number(declared) > maxBytes)) throw refuse();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const part = await read(() => reader!.read());
        if (part.done) break;
        size += part.value.byteLength; if (size > maxBytes) throw refuse(); chunks.push(part.value);
      }
      check();
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (encoder.encode(text).byteLength > maxBytes) throw refuse();
      const value = guard(JSON.parse(text), expected);
      check();
      if (lifetimeOwner !== undefined && lifetimeOwner !== value.wallet) throw refuse();
      lifetimeOwner ??= value.wallet;
      return value;
    } catch { throw refuse(); }
    finally {
      controller.abort(); clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", stop);
      if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
      else if (response?.body) void response.body.cancel().catch(() => undefined);
    }
  }
  const safe = async <T>(fn: () => Promise<T>) => { try { return await fn(); } catch { throw refuse(); } };
  return {
    current: () => {
      if (!lifetimeKey || key() !== lifetimeKey) throw refuse();
    },
    list: (raw = {}, options = {}) => safe(() => {
      const input = parsePrivateJobHistoryInput(raw);
      return request("/api/me/private-jobs", input, B.pageBytes, B.readMs, options,
        (value, expected) => guardPrivateJobHistoryPage(value, input, expected));
    }),
    detail: (raw, options = {}) => safe(() => {
      const input = privateJobHistoryDetailInputSchema.parse(portable(raw, B.requestBytes));
      return request("/api/me/private-jobs/detail", input, B.detailBytes, B.readMs, options,
        (value, expected) => guardPrivateJobHistoryDetail(value, input.id, expected));
    }),
    export: (raw = {}, options = {}) => safe(() => {
      const input = parsePrivateJobHistoryInput(raw);
      return request("/api/me/private-jobs/export", { ...input, format: "json" }, B.exportBytes, B.exportMs, options,
        (value, expected) => guardPrivateJobHistoryExport(value, input, expected));
    }),
  };
}

/** Manual metadata-only serialization. Server serializer remains server-only; importing
 * its storage/payment graph into a key-only CLI would violate that client's role. */
export function privateJobHistoryMetadataCsv(value: PrivateJobHistoryExport): string {
  const parsed = privateJobHistoryExportSchema.parse(portable(value, B.exportBytes));
  const cell = (value: unknown) => {
    const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return `"${(/^[\s\uFEFF]*[=+\-@]/u.test(raw) ? `'${raw}` : raw).replaceAll('"', '""')}"`;
  };
  const fields = ["id", "createdAt", "intentCreatedAt", "savedAt", "question", "researchMode", "model", "provenance",
    "incomingSettlement", "ownSettledSpendMicros", "creatorRewardsMicros", "paidCreators"] as const;
  const csv = [["record", ...fields], ["metadata", JSON.stringify({ wallet: parsed.wallet, scope: parsed.scope,
    complete: parsed.complete, truncated: parsed.truncated, nextCursor: parsed.nextCursor, bounds: parsed.bounds,
    capabilities: parsed.capabilities, qualification: parsed.qualification }), ...Array(fields.length - 1).fill("")],
    ...parsed.rows.map(row => [row.record, ...fields.map(field => row[field])])].map(line => line.map(cell).join(",")).join("\r\n") + "\r\n";
  if (encoder.encode(csv).byteLength > B.exportBytes) throw refuse();
  return csv;
}
