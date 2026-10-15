import { createHash } from "node:crypto";
import { z } from "zod";
import { paperRecordSchema, type PaperRecord } from "../papers/types";

const MINUTE = 60_000, DAY = 86_400_000;
const MAX_HISTORY = 128, MAX_WATERMARK = 256, MAX_READ_MS = 30_000;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value));
const terms = (maximum: number, length: number, minimum = 0) => z.array(text(length)).min(minimum).max(maximum)
  .refine(values => new Set(values.map(fold)).size === values.length);
const keySchema = z.object({
  ownerWallet: z.string().regex(/^0x[0-9a-f]{40}$/),
  watchId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
}).strict();

export const topicWatchSpecSchema = z.object({
  watchId: keySchema.shape.watchId,
  question: text(2000), keywords: terms(8, 80, 1),
  authors: terms(4, 300).default([]), venues: terms(4, 300).default([]),
  cadenceMs: integer.min(MINUTE).max(7 * DAY),
  periodMs: integer.min(MINUTE).max(30 * DAY),
  maximumChecksPerPeriod: integer.min(1).max(128),
  maximumRowsPerCheck: integer.min(1).max(32),
  maximumDigestItems: integer.min(1).max(16),
  expiresAtMs: integer,
  requestedCaps: z.object({ perCheckMicroUsdc: integer.max(1_000_000_000),
    perPeriodMicroUsdc: integer.max(1_000_000_000) }).strict(),
  // Consent is to manual metadata reads only. It cannot authorize scheduling or money.
  consent: z.object({ manualMetadata: z.literal(true), emptyHeartbeat: z.boolean() }).strict(),
}).strict().refine(spec => spec.periodMs >= spec.cadenceMs &&
  spec.requestedCaps.perCheckMicroUsdc <= spec.requestedCaps.perPeriodMicroUsdc);

export type TopicWatchSpec = z.infer<typeof topicWatchSpecSchema>;
export type TopicWatchKey = z.infer<typeof keySchema>;
type WatchStatus = "active" | "paused" | "cancelled";
const failureSchema = z.enum(["metadata-unavailable", "invalid-metadata", "conflicting-metadata",
  "watermark-full", "digest-full", "completion-window-elapsed", "paused", "cancelled", "expired",
  "aborted", "period-cap"]);
const checkSchema = z.object({
  kind: z.literal("check"), checkId: hash, slot: integer, periodIndex: integer,
  claimedAtMs: integer, deadlineAtMs: integer,
  status: z.enum(["pending", "completed", "unchanged", "failed", "interrupted", "limited"]),
  reason: failureSchema.optional(), finishedAtMs: integer.optional(),
  observedRows: integer.max(32).optional(), unknownRows: integer.max(32).optional(),
  newMatches: integer.max(16).optional(),
}).strict();
const missedSchema = z.object({ kind: z.literal("missed"), fromSlot: integer,
  toSlot: integer, detectedAtMs: integer }).strict().refine(value => value.toSlot >= value.fromSlot);
const stateSchema = z.object({
  version: z.literal(1), scope: z.literal("metadata-only"), key: keySchema,
  revision: integer.min(1), incarnation: hash, createdAtMs: integer,
  spec: topicWatchSpecSchema, status: z.enum(["active", "paused", "cancelled"]),
  nextSlot: integer,
  period: z.object({ index: integer, attempts: integer.max(128) }).strict(),
  history: z.array(z.union([checkSchema, missedSchema])).max(MAX_HISTORY),
  watermark: z.array(z.object({ identitySha256: hash, metadataSha256: hash }).strict()).max(MAX_WATERMARK),
}).strict().superRefine((state, ctx) => {
  const refuse = () => ctx.addIssue({ code: "custom", message: "Invalid watch state" });
  if (state.key.watchId !== state.spec.watchId || state.spec.expiresAtMs <= state.createdAtMs ||
    state.spec.expiresAtMs - state.createdAtMs > 30 * DAY ||
    state.incarnation !== incarnation(state.key, state.spec, state.createdAtMs)) refuse();
  let cursor = 0, pending = 0, attempts = 0;
  const periodAttempts = new Map<number, number>();
  for (const entry of state.history) {
    if (entry.kind === "missed") {
      if (entry.fromSlot !== cursor || entry.detectedAtMs < state.createdAtMs + (entry.toSlot + 1) * state.spec.cadenceMs ||
        entry.detectedAtMs >= state.spec.expiresAtMs) refuse();
      cursor = entry.toSlot + 1;
    } else {
      if (entry.slot !== cursor || entry.checkId !== checkIdentity(state, entry.slot) ||
        entry.claimedAtMs < state.createdAtMs ||
        entry.slot !== Math.floor((entry.claimedAtMs - state.createdAtMs) / state.spec.cadenceMs) ||
        entry.periodIndex !== Math.floor((entry.claimedAtMs - state.createdAtMs) / state.spec.periodMs) ||
        entry.deadlineAtMs <= entry.claimedAtMs || entry.deadlineAtMs > state.spec.expiresAtMs ||
        entry.deadlineAtMs > state.createdAtMs + (entry.slot + 1) * state.spec.cadenceMs ||
        entry.deadlineAtMs - entry.claimedAtMs > MAX_READ_MS) refuse();
      cursor++;
      if (entry.status === "pending") {
        pending++;
        if (entry.slot !== state.nextSlot - 1 || entry.reason || entry.finishedAtMs !== undefined || entry.observedRows !== undefined ||
          entry.unknownRows !== undefined || entry.newMatches !== undefined) refuse();
      } else if (entry.finishedAtMs === undefined || entry.finishedAtMs < entry.claimedAtMs ||
        (["failed", "interrupted", "limited"].includes(entry.status) ? !entry.reason : !!entry.reason)) refuse();
      if (entry.status === "completed" || entry.status === "unchanged") {
        if (entry.observedRows === undefined || entry.unknownRows === undefined || entry.newMatches === undefined ||
          entry.observedRows + entry.unknownRows > state.spec.maximumRowsPerCheck ||
          entry.newMatches > state.spec.maximumDigestItems || entry.newMatches > entry.observedRows ||
          entry.finishedAtMs! >= entry.deadlineAtMs || (entry.status === "unchanged" ? entry.newMatches !== 0 : !entry.newMatches)) refuse();
      } else if (entry.observedRows !== undefined || entry.unknownRows !== undefined || entry.newMatches !== undefined) refuse();
      if (entry.status === "limited" && entry.reason !== "period-cap" ||
        entry.status === "interrupted" && !["paused", "cancelled", "expired", "aborted"].includes(entry.reason ?? "") ||
        entry.status === "failed" && ["paused", "cancelled", "expired", "aborted", "period-cap"].includes(entry.reason ?? "")) refuse();
      if (entry.status !== "limited") periodAttempts.set(entry.periodIndex, (periodAttempts.get(entry.periodIndex) ?? 0) + 1);
      if (entry.periodIndex === state.period.index && entry.status !== "limited") attempts++;
      if (entry.periodIndex > state.period.index) refuse();
    }
  }
  if (cursor !== state.nextSlot || pending > 1 || pending && state.status !== "active" ||
    attempts !== state.period.attempts || attempts > state.spec.maximumChecksPerPeriod ||
    [...periodAttempts.values()].some(count => count > state.spec.maximumChecksPerPeriod) ||
    new Set(state.watermark.map(stamp)).size !== state.watermark.length) refuse();
});

export type TopicWatchState = z.infer<typeof stateSchema>;
/** Storage boundary uses the same complete-state validator as the domain. */
export function parseTopicWatchState(value: unknown): TopicWatchState {
  return stateSchema.parse(portable(value, 262_144));
}
type Check = z.infer<typeof checkSchema>;
type Failure = z.infer<typeof failureSchema>;

/** Reads must be linearizable private
 * snapshots, and CAS must atomically compare the exact namespace/revision and
 * trusted store time < notAfterMs, and persist the complete next state. A false
 * result makes no change. Throws/unknown acknowledgements never permit a retry.
 * Retain tombstones; never delete/recreate a key or rewind history/capacity.
 * All control writers must use this same CAS; an unqualified adapter is unavailable. */
export interface TopicWatchStore {
  read(key: Readonly<TopicWatchKey>): Promise<unknown | null>;
  compareAndSwap(key: Readonly<TopicWatchKey>, expectedRevision: number | null,
    next: Readonly<TopicWatchState>, notAfterMs: number): Promise<boolean>;
}

export interface TopicWatchMetadataRequest {
  readonly scope: "metadata-only";
  readonly key: Readonly<TopicWatchKey>;
  readonly checkId: string;
  readonly question: string;
  readonly keywords: readonly string[];
  readonly authors: readonly string[];
  readonly venues: readonly string[];
  readonly maximumRows: number;
  readonly deadlineAtMs: number;
}
/** Trusted adapter to existing metadata ONLY, with bounded acquisition/response.
 * No default, live discovery import, paid fallback, full body or model capability.
 * The adapter itself needs separate zero-paid-reachability qualification. */
export interface TopicWatchMetadataPort {
  read(request: TopicWatchMetadataRequest, signal?: AbortSignal): Promise<unknown>;
}
export interface TopicWatchDependencies {
  store: TopicWatchStore;
  metadata: TopicWatchMetadataPort;
  now(): number;
  /** Bound to the originally verified owner AND revocable session/authority
   * instance, never request data or any later session for the same wallet.
   * Must fail closed on revoked, replaced, changed or unavailable identity. */
  isOwnerCurrent(exactOwnerWallet: string): boolean;
}

const observedSchema = z.object({ state: z.literal("observed"), record: paperRecordSchema }).strict();
const unknownSchema = z.object({ state: z.literal("unknown"),
  reason: z.enum(["not-established", "incomplete-metadata"]) }).strict();
const batchSchema = z.object({ version: z.literal(1), scope: z.literal("metadata-only"),
  status: z.enum(["available", "empty", "unavailable"]), complete: z.literal(true),
  rows: z.array(z.union([observedSchema, unknownSchema])).max(32),
}).strict().refine(batch => batch.status === "available" ? batch.rows.length > 0 : batch.rows.length === 0);

export interface TopicWatchDigestItem {
  identitySha256: string; metadataSha256: string;
  title: string; titleTruncated: boolean; url: string;
  matchReasons: Array<{ field: "title" | "author" | "venue"; term: string }>;
}
export interface TopicWatchResult {
  status: "created" | "controlled" | "completed" | "unchanged" | "failed" | "interrupted" |
    "limited" | "already-recorded" | "missed" | "overlap" | "refused" | "conflict";
  code?: string;
  checkId?: string;
  recordedStatus?: "completed" | "unchanged" | "failed" | "interrupted" | "limited";
  missed?: { fromSlot: number; toSlot: number; count: number };
  counts?: { observedRows: number; unknownRows: number; newMatches: number };
  watermarkSha256?: string;
  digest?: { scope: "metadata-only"; line: string; items: TopicWatchDigestItem[] };
  paidRequests: 0;
  standingSpend: "withheld";
}
const result = (value: Omit<TopicWatchResult, "paidRequests" | "standingSpend">): TopicWatchResult =>
  ({ ...value, paidRequests: 0, standingSpend: "withheld" });
class WatchRefusal extends Error { constructor(readonly code: string) { super(code); } }
function refuse(code: string): never { throw new WatchRefusal(code); }
const refusal = (error: unknown): TopicWatchResult => result({ status: "refused",
  code: error instanceof WatchRefusal ? error.code : "dependency-unavailable" });
function fold(value: string): string { return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " "); }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) refuse("invalid-data");
  return encoded;
}
const sha = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const incarnation = (key: TopicWatchKey, spec: TopicWatchSpec, createdAtMs: number) => sha({ key, spec, createdAtMs });
const checkIdentity = (state: Pick<TopicWatchState, "key" | "incarnation">, slot: number) => sha({ key: state.key, incarnation: state.incarnation, slot });
const stamp = (value: { identitySha256: string; metadataSha256: string }) => `${value.identitySha256}:${value.metadataSha256}`;

/** Local strict data copier: rejects hooks, undefined, hidden/symbol properties,
 * sparse arrays, cycles, exotic objects, malformed UTF-16 and overbound traversal.
 * Inputs must already be data from a trusted transport, never executable proxies. */
function portable(value: unknown, maximumBytes: number): unknown {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>(), encoder = new TextEncoder();
  const charge = (unit: string) => { bytes += encoder.encode(unit).length; if (bytes > maximumBytes) refuse("invalid-data"); };
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 12) refuse("invalid-data");
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) {
      charge(JSON.stringify(item)); return item;
    }
    if (typeof item === "string") {
      if (item.length > maximumBytes || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item)) refuse("invalid-data");
      charge(JSON.stringify(item)); return item;
    }
    if (!item || typeof item !== "object" || ancestors.has(item)) refuse("invalid-data");
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype :
      ![Object.prototype, null].includes(Object.getPrototypeOf(item))) refuse("invalid-data");
    const keys = Reflect.ownKeys(item);
    if (keys.length > (array ? 513 : 64) || keys.some(key => typeof key !== "string")) refuse("invalid-data");
    ancestors.add(item); charge(array ? "[]" : "{}");
    const copy: unknown[] | Record<string, unknown> = array ? [] : Object.create(null);
    if (array && ((item as unknown[]).length > 512 || keys.length !== (item as unknown[]).length + 1)) refuse("invalid-data");
    for (const key of keys as string[]) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!descriptor.enumerable || !("value" in descriptor) || key.length > 4096 ||
        array && !/^(0|[1-9][0-9]*)$/.test(key)) refuse("invalid-data");
      charge(JSON.stringify(key) + ":,");
      const copied = visit(descriptor.value, depth + 1);
      if (array) (copy as unknown[]).push(copied);
      else (copy as Record<string, unknown>)[key] = copied;
    }
    ancestors.delete(item); return copy;
  };
  return visit(value, 0);
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen); Object.freeze(value);
  }
  return value;
}
function keyCopy(value: unknown): TopicWatchKey { return keySchema.parse(portable(value, 1024)); }
function clock(deps: TopicWatchDependencies): number { return integer.parse(deps.now()); }
function owner(deps: TopicWatchDependencies, key: TopicWatchKey, signal?: AbortSignal): void {
  if (signal?.aborted) refuse("aborted");
  if (deps.isOwnerCurrent(key.ownerWallet) !== true) refuse("owner-unavailable");
}
function allowed(state: TopicWatchState, now: number): void {
  if (now < state.createdAtMs) refuse("clock-regressed");
  if (state.status !== "active") refuse(state.status);
  if (now >= state.spec.expiresAtMs) refuse("expired");
}
async function load(deps: TopicWatchDependencies, key: TopicWatchKey, signal?: AbortSignal): Promise<TopicWatchState | null> {
  owner(deps, key, signal); // before every awaited state read, and again after completion
  const raw = await deps.store.read(frozen({ ...key }));
  owner(deps, key, signal);
  if (raw === null) return null;
  const state = stateSchema.parse(portable(raw, 262_144));
  if (state.key.ownerWallet !== key.ownerWallet || state.key.watchId !== key.watchId) refuse("state-unavailable");
  return state;
}
async function swap(deps: TopicWatchDependencies, key: TopicWatchKey, expected: number | null,
  next: TopicWatchState, deadline: number): Promise<boolean> {
  owner(deps, key);
  const copy = stateSchema.parse(portable(next, 262_144));
  if (copy.revision !== (expected ?? 0) + 1 || clock(deps) >= deadline) return false;
  return await deps.store.compareAndSwap(frozen({ ...key }), expected, frozen(copy), deadline) === true;
}

export async function createTopicWatch(deps: TopicWatchDependencies, exactOwnerWallet: string,
  input: unknown): Promise<TopicWatchResult> {
  try {
    const spec = topicWatchSpecSchema.parse(portable(input, 16_384));
    const key = keyCopy({ ownerWallet: exactOwnerWallet, watchId: spec.watchId });
    owner(deps, key);
    const now = clock(deps);
    if (spec.expiresAtMs <= now || spec.expiresAtMs - now > 30 * DAY) refuse("invalid-expiry");
    const state: TopicWatchState = { version: 1, scope: "metadata-only", key, revision: 1,
      incarnation: incarnation(key, spec, now), createdAtMs: now, spec, status: "active",
      nextSlot: 0, period: { index: 0, attempts: 0 }, history: [], watermark: [] };
    const saved = await swap(deps, key, null, state, Math.min(spec.expiresAtMs, now + MAX_READ_MS));
    owner(deps, key);
    return result({ status: saved ? "created" : "conflict" });
  } catch (error) { return refusal(error); }
}

/** Pause/resume/cancel is explicit, owner-scoped and CAS-bound. A pending read is
 * terminally interrupted; resume cannot retry its old slot or restore capacity. */
export async function controlTopicWatch(deps: TopicWatchDependencies, keyInput: unknown,
  requestedStatus: WatchStatus, expectedRevision?: number): Promise<TopicWatchResult> {
  try {
    const key = keyCopy(keyInput), status = z.enum(["active", "paused", "cancelled"]).parse(requestedStatus);
    const state = await load(deps, key);
    if (!state) refuse("not-found");
    if (expectedRevision !== undefined && state.revision !== expectedRevision) return result({ status: "conflict" });
    const now = clock(deps);
    if (state.status === "cancelled" && status !== "cancelled") refuse("cancelled");
    if (status === "active" && now >= state.spec.expiresAtMs) refuse("expired");
    if (now < state.createdAtMs) refuse("clock-regressed");
    if (state.status === status) return result({ status: "controlled" });
    const reason = status === "cancelled" ? "cancelled" : "paused";
    const history = state.history.map(entry => entry.kind === "check" && entry.status === "pending"
      ? { ...entry, status: "interrupted" as const, reason: reason as Failure, finishedAtMs: now } : entry);
    const saved = await swap(deps, key, state.revision, { ...state, revision: state.revision + 1, status, history }, now + MAX_READ_MS);
    owner(deps, key);
    return result({ status: saved ? "controlled" : "conflict" });
  } catch (error) { return refusal(error); }
}

/** Settings cannot reinterpret admitted history, capacity or an in-flight read.
 * After the first admitted slot use pause/cancel or create a distinct watch. */
export async function updateTopicWatch(deps: TopicWatchDependencies, keyInput: unknown,
  input: unknown, expectedRevision: number): Promise<TopicWatchResult> {
  try {
    const key = keyCopy(keyInput), spec = topicWatchSpecSchema.parse(portable(input, 16_384));
    const state = await load(deps, key);
    if (!state) refuse("not-found");
    if (state.revision !== expectedRevision) return result({ status: "conflict" });
    if (state.status === "cancelled") refuse("cancelled");
    if (state.nextSlot !== 0 || state.history.length || state.watermark.length) refuse("settings-locked");
    const now = clock(deps);
    if (now < state.createdAtMs || now >= state.spec.expiresAtMs) refuse("expired");
    if (spec.watchId !== key.watchId || spec.expiresAtMs <= now || spec.expiresAtMs - state.createdAtMs > 30 * DAY)
      refuse("invalid-expiry");
    const next = { ...state, spec, incarnation: incarnation(key, spec, state.createdAtMs), revision: state.revision + 1 };
    const saved = await swap(deps, key, state.revision, next, Math.min(state.spec.expiresAtMs, spec.expiresAtMs, now + MAX_READ_MS));
    owner(deps, key);
    return result({ status: saved ? "controlled" : "conflict" });
  } catch (error) { return refusal(error); }
}

function pending(state: TopicWatchState): Check | undefined {
  return state.history.find((entry): entry is Check => entry.kind === "check" && entry.status === "pending");
}
function sameClaim(state: TopicWatchState, claim: TopicWatchState, check: Check): boolean {
  return state.revision === claim.revision && state.incarnation === claim.incarnation &&
    pending(state)?.checkId === check.checkId;
}
function withTerminal(state: TopicWatchState, check: Check, status: Check["status"], now: number,
  extra: Partial<Check> = {}): TopicWatchState {
  return { ...state, revision: state.revision + 1, history: state.history.map(entry =>
    entry.kind === "check" && entry.checkId === check.checkId ? { ...entry, ...extra, status, finishedAtMs: now } : entry) };
}
async function failClaim(deps: TopicWatchDependencies, state: TopicWatchState, check: Check,
  reason: Failure): Promise<TopicWatchResult> {
  const now = clock(deps), status = ["paused", "cancelled", "expired", "aborted"].includes(reason) ? "interrupted" : "failed";
  const next = withTerminal(state, check, status, now, { reason });
  const saved = await swap(deps, state.key, state.revision, next, now + MAX_READ_MS);
  owner(deps, state.key);
  const prior = state.history[state.history.findIndex(entry => entry.kind === "check" && entry.checkId === check.checkId) - 1];
  const missed = prior?.kind === "missed" ? { fromSlot: prior.fromSlot, toSlot: prior.toSlot,
    count: prior.toSlot - prior.fromSlot + 1 } : undefined;
  return result({ status: saved ? status : "conflict", checkId: check.checkId, code: reason,
    ...(missed ? { missed } : {}) });
}
function liveFailure(deps: TopicWatchDependencies, state: TopicWatchState, check: Check,
  signal?: AbortSignal): Failure | undefined {
  if (signal?.aborted) return "aborted";
  if (state.status !== "active") return state.status;
  const now = clock(deps);
  if (now >= state.spec.expiresAtMs) return "expired";
  if (now >= check.deadlineAtMs) return "completion-window-elapsed";
  if (now < check.claimedAtMs) refuse("clock-regressed");
}

function reasons(spec: TopicWatchSpec, record: PaperRecord): TopicWatchDigestItem["matchReasons"] {
  const keywordMatches = spec.keywords.filter(term => fold(record.title).includes(fold(term)));
  const authorMatches = spec.authors.filter(term => record.authors.some(name => fold(name) === fold(term)));
  const venueMatches = spec.venues.filter(term => record.venue !== undefined && fold(record.venue) === fold(term));
  if (!keywordMatches.length || spec.authors.length && !authorMatches.length || spec.venues.length && !venueMatches.length) return [];
  return [...keywordMatches.map(term => ({ field: "title" as const, term })),
    ...authorMatches.map(term => ({ field: "author" as const, term })),
    ...venueMatches.map(term => ({ field: "venue" as const, term }))];
}
function summarize(state: TopicWatchState, raw: unknown) {
  let batch: z.infer<typeof batchSchema>;
  try { batch = batchSchema.parse(portable(raw, 131_072)); } catch { refuse("invalid-metadata"); }
  if (batch.status === "unavailable") refuse("metadata-unavailable");
  if (batch.rows.length > state.spec.maximumRowsPerCheck) refuse("invalid-metadata");
  const observed = new Map<string, { record: PaperRecord; metadataSha256: string }>();
  let unknownRows = 0;
  for (const row of batch.rows) {
    if (row.state === "unknown") { unknownRows++; continue; }
    const record = row.record;
    const identitySha256 = sha({ repository: record.repository, url: record.url,
      ...(record.doi ? { doi: record.doi } : {}), ...(record.arxivId ? { arxivId: record.arxivId } : {}) });
    // Acquisition time alone is not a metadata change. Retain all other original fields.
    const { metadataObservedAt: ignored, ...content } = record;
    void ignored;
    const metadataSha256 = sha(content), prior = observed.get(identitySha256);
    if (prior && prior.metadataSha256 !== metadataSha256) refuse("conflicting-metadata");
    observed.set(identitySha256, { record, metadataSha256 });
  }
  const seen = new Set(state.watermark.map(stamp)), items: TopicWatchDigestItem[] = [];
  const additions: TopicWatchState["watermark"] = [];
  for (const [identitySha256, { record, metadataSha256 }] of [...observed].sort(([a], [b]) => compare(a, b))) {
    const matchReasons = reasons(state.spec, record), entry = { identitySha256, metadataSha256 };
    if (!matchReasons.length || seen.has(stamp(entry))) continue;
    items.push({ ...entry, title: [...record.title].slice(0, 240).join(""),
      titleTruncated: [...record.title].length > 240, url: record.url, matchReasons });
    additions.push(entry);
  }
  if (items.length > state.spec.maximumDigestItems) refuse("digest-full");
  if (state.watermark.length + additions.length > MAX_WATERMARK) refuse("watermark-full");
  const watermark = [...state.watermark, ...additions].sort((a, b) => compare(stamp(a), stamp(b)));
  return { items, watermark, counts: { observedRows: batch.rows.length - unknownRows, unknownRows, newMatches: items.length } };
}

/** One manual cadence slot, one admitted bounded read, no automatic retry/catch-up.
 * Pending/failed work retains its period count; elapsed pending work is terminalized
 * by a separate manual call before another slot can be admitted. */
export async function runTopicWatchCheck(deps: TopicWatchDependencies, keyInput: unknown,
  signal?: AbortSignal, expectedRevision?: number): Promise<TopicWatchResult> {
  try {
    const key = keyCopy(keyInput);
    const state = await load(deps, key, signal);
    if (!state) refuse("not-found");
    if (expectedRevision !== undefined && state.revision !== expectedRevision) return result({ status: "conflict" });
    const now = clock(deps), inFlight = pending(state);
    // Current-owner cleanup of an admitted elapsed claim is not new work.
    if (inFlight && now >= inFlight.deadlineAtMs) return await failClaim(deps, state, inFlight,
      now >= state.spec.expiresAtMs ? "expired" : "completion-window-elapsed");
    allowed(state, now);
    if (inFlight) return result({ status: "overlap", checkId: inFlight.checkId });
    const slot = Math.floor((now - state.createdAtMs) / state.spec.cadenceMs);
    if (slot < state.nextSlot) {
      const prior = state.history.find(entry => entry.kind === "check" ? entry.slot === slot :
        entry.fromSlot <= slot && entry.toSlot >= slot);
      if (prior?.kind === "missed") return result({ status: "missed", checkId: checkIdentity(state, slot),
        missed: { fromSlot: prior.fromSlot, toSlot: prior.toSlot, count: prior.toSlot - prior.fromSlot + 1 } });
      if (!prior || prior.kind !== "check" || prior.status === "pending") refuse("state-unavailable");
      return result({ status: "already-recorded", checkId: prior.checkId, recordedStatus: prior.status,
        ...(prior.reason ? { code: prior.reason } : {}) });
    }
    const periodIndex = Math.floor((now - state.createdAtMs) / state.spec.periodMs);
    if (periodIndex < state.period.index) refuse("clock-regressed");
    const attempts = periodIndex === state.period.index ? state.period.attempts : 0;
    const missed = slot > state.nextSlot ? { fromSlot: state.nextSlot, toSlot: slot - 1, count: slot - state.nextSlot } : undefined;
    if (state.history.length + (missed ? 2 : 1) > MAX_HISTORY) refuse("history-full");
    const limited = attempts >= state.spec.maximumChecksPerPeriod;
    const check: Check = { kind: "check", checkId: checkIdentity(state, slot), slot, periodIndex,
      claimedAtMs: now, deadlineAtMs: Math.min(now + MAX_READ_MS, state.spec.expiresAtMs,
        state.createdAtMs + (slot + 1) * state.spec.cadenceMs), status: limited ? "limited" : "pending",
      ...(limited ? { reason: "period-cap" as const, finishedAtMs: now } : {}) };
    const claim: TopicWatchState = { ...state, revision: state.revision + 1, nextSlot: slot + 1,
      period: { index: periodIndex, attempts: attempts + (limited ? 0 : 1) },
      history: [...state.history, ...(missed ? [{ kind: "missed" as const,
        fromSlot: missed.fromSlot, toSlot: missed.toSlot, detectedAtMs: now }] : []), check] };
    if (!await swap(deps, key, state.revision, claim, check.deadlineAtMs)) return result({ status: "conflict" });
    owner(deps, key);
    if (limited) return result({ status: "limited", code: "period-cap", checkId: check.checkId, ...(missed ? { missed } : {}) });

    // Recheck the committed claim before the sole awaited metadata read.
    const stoppedClaim = liveFailure(deps, claim, check, signal);
    if (stoppedClaim) return await failClaim(deps, claim, check, stoppedClaim);
    const before = await load(deps, key);
    if (!before || !sameClaim(before, claim, check)) return result({ status: "interrupted", code: "state-changed", checkId: check.checkId });
    const stoppedBefore = liveFailure(deps, before, check, signal);
    if (stoppedBefore) return await failClaim(deps, before, check, stoppedBefore);
    owner(deps, key, signal);
    const request: TopicWatchMetadataRequest = frozen({ scope: "metadata-only", key: { ...key },
      checkId: check.checkId, question: before.spec.question, keywords: [...before.spec.keywords],
      authors: [...before.spec.authors], venues: [...before.spec.venues],
      maximumRows: before.spec.maximumRowsPerCheck, deadlineAtMs: check.deadlineAtMs });
    let raw: unknown, readFailed = false;
    try { raw = await deps.metadata.read(request, signal); } catch { readFailed = true; }

    // Reauthorize and refresh before classifying or terminalizing a late read;
    // a retained terminal/replaced claim must never take a stale failure CAS.
    // Read failures do not fall back, retry or free their consumed attempt.
    const current = await load(deps, key);
    if (!current || !sameClaim(current, claim, check)) return result({ status: "interrupted", code: "state-changed", checkId: check.checkId });
    const stoppedAfter = liveFailure(deps, current, check, signal);
    if (stoppedAfter) return await failClaim(deps, current, check, stoppedAfter);
    if (readFailed) return await failClaim(deps, current, check, "metadata-unavailable");
    let summary: ReturnType<typeof summarize>;
    try { summary = summarize(current, raw); } catch (error) {
      const code = error instanceof WatchRefusal ? error.code : "invalid-metadata";
      return await failClaim(deps, current, check, failureSchema.parse(code));
    }
    const finishedAtMs = clock(deps), status = summary.items.length ? "completed" : "unchanged";
    if (finishedAtMs >= check.deadlineAtMs) return await failClaim(deps, current, check, "completion-window-elapsed");
    const completed = { ...withTerminal(current, check, status, finishedAtMs, summary.counts), watermark: summary.watermark };
    if (!await swap(deps, key, current.revision, completed, check.deadlineAtMs)) return result({ status: "conflict", checkId: check.checkId });

    // A committed result is not permission to release it after revocation/control.
    const stoppedCompletion = liveFailure(deps, completed, check, signal);
    if (stoppedCompletion) return result({ status: "interrupted", code: stoppedCompletion, checkId: check.checkId });
    const release = await load(deps, key, signal);
    if (!release || release.revision !== completed.revision || release.incarnation !== claim.incarnation)
      return result({ status: "interrupted", code: "state-changed", checkId: check.checkId });
    allowed(release, clock(deps));
    if (clock(deps) >= check.deadlineAtMs) return result({ status: "interrupted", code: "completion-window-elapsed", checkId: check.checkId });
    const digest = summary.items.length ? { scope: "metadata-only" as const,
      line: `${summary.items.length} new lexical metadata matches; factual support and peer review unverified.`, items: summary.items }
      : release.spec.consent.emptyHeartbeat ? { scope: "metadata-only" as const,
        line: "No new lexical metadata matches; unknown metadata is not evidence of absence.", items: [] } : undefined;
    return result({ status, checkId: check.checkId, counts: summary.counts, watermarkSha256: sha(summary.watermark),
      ...(missed ? { missed } : {}), ...(digest ? { digest } : {}) });
  } catch (error) { return refusal(error); }
}
