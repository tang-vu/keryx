/** Read-only Circle API facts. Neither payment authority nor chain finality. */
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db";
import { canonicalJson } from "../canonical-json";
import {
  validateBrowserSigningSnapshot,
  type BrowserSigningSnapshot,
} from "../db/browser-signing-originals";
import type { KeryxDB } from "../db/keryx-db";

const fetchRead = globalThis.fetch.bind(globalThis),
  now = performance.now.bind(performance);
const ENDPOINT = "https://gateway-api-testnet.circle.com/v1/x402/transfers";
const TOTAL_MS = 30000,
  REQUEST_MS = 5000,
  TTL_MS = 5000,
  MAX_BYTES = 4 * 1024 * 1024;
const locatorSchema = z
  .object({
    namespace: z.string().regex(/^0x[0-9a-f]{64}$/),
    queryId: z.string().uuid(),
    sessionId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    transferIdHint: z.string().uuid().optional(),
  })
  .strict();
export type BrowserX402SettlementLocator = z.infer<typeof locatorSchema>;
const statuses = [
  "received",
  "batched",
  "confirmed",
  "completed",
  "failed",
] as const;
const transferSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(statuses),
    token: z.literal("USDC"),
    sendingNetwork: z.string().max(64),
    recipientNetwork: z.string().max(64),
    fromAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    toAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    amount: z.string().regex(/^(0|[1-9][0-9]{0,77})$/),
    nonce: z.string().regex(/^(?:0x)?[0-9a-fA-F]{64}$/),
    txHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
type Transfer = z.infer<typeof transferSchema>;
export interface BrowserX402TransferObservation {
  readonly format: "browser-x402-transfer-observation-v1";
  readonly basis: "circle-api";
  readonly chainFinality: "not-verified";
  readonly backendTrust: "installed-runtime-adapter";
  readonly scope: "nonce-filtered-returned-api-pages";
  readonly namespace: string;
  readonly queryId: string;
  readonly requestId: string;
  readonly originalDigest: string;
  readonly queryProofDigest: string;
  readonly observedAt: string;
  readonly transfer: Readonly<Transfer>;
}
declare const observationBrand: unique symbol;
export type VerifiedBrowserX402TransferObservation = {
  readonly [observationBrand]: true;
};
type Reason = "binding" | "provider" | "incomplete" | "deadline" | "capacity";
export type BrowserX402ObservationResult =
  | {
      readonly status: "observed";
      readonly token: VerifiedBrowserX402TransferObservation;
    }
  | { readonly status: "unavailable"; readonly reason: Reason };
class Unavailable extends Error {
  constructor(readonly reason: Reason) {
    super("Browser transfer observation unavailable");
  }
}
function fail(reason: Reason): never {
  throw new Unavailable(reason);
}
const hash = (value: unknown) =>
  `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const phases = new Set([
  "exposed",
  "signed",
  "submission_attempted",
  "settled",
  "failed",
]);
const records = new WeakMap<
  object,
  {
    locator: string;
    adapter: KeryxDB;
    fingerprint: string;
    matchedAt: number;
    evidence: BrowserX402TransferObservation;
  }
>();
let active = 0;
function lifetime(limitMs: number) {
  const started = now(),
    stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), limitMs);
  const live = () => {
    const elapsed = now() - started;
    if (
      stop.signal.aborted ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      elapsed >= limitMs
    )
      fail("deadline");
  };
  return { stop, live, close: () => clearTimeout(timer) };
}
async function bounded<T>(
  work: (life: ReturnType<typeof lifetime>) => Promise<T>,
  limitMs = TOTAL_MS
): Promise<T> {
  if (!Number.isFinite(limitMs) || limitMs <= 0) return fail("deadline");
  if (active >= 8) return fail("capacity");
  const life = lifetime(limitMs);
  active++;
  // A deadline does not free the slot while noncancelable backend work remains.
  const pending = (async () => {
    try {
      return await work(life);
    } finally {
      life.close();
      active--;
    }
  })();
  let cancel!: () => void;
  const expired = new Promise<never>((_, reject) => {
    cancel = () => reject(new Unavailable("deadline"));
  });
  life.stop.signal.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([pending, expired]);
  } finally {
    life.stop.signal.removeEventListener("abort", cancel);
  }
}
const capture = (value: BrowserX402SettlementLocator) => {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.getOwnPropertySymbols(value).length
    )
      fail("binding");
    if (
      Object.values(Object.getOwnPropertyDescriptors(value)).some(
        (d) => !("value" in d) || !d.enumerable
      )
    )
      fail("binding");
    return Object.freeze(locatorSchema.parse(value));
  } catch {
    return fail("binding");
  }
};
function fingerprint(snapshot: BrowserSigningSnapshot) {
  return hash({
    original: snapshot.original,
    policy: snapshot.policy,
    query: {
      namespace: snapshot.query.namespace,
      queryId: snapshot.query.queryId,
      proofDigest: snapshot.query.proofDigest,
    },
    owner: snapshot.namespace.owner,
    signer: snapshot.namespace.signer,
  });
}
async function read(
  adapter: KeryxDB,
  locator: BrowserX402SettlementLocator,
  live: () => void
): Promise<BrowserSigningSnapshot> {
  live();
  const hint = await adapter.getBrowserJournal(
    locator.sessionId,
    locator.requestId
  );
  live();
  if (!hint || !phases.has(hint.phase)) fail("binding");
  const value = await adapter.readExposedBrowserSigningSnapshotForSigner(
    hint.signer,
    locator.sessionId,
    locator.requestId
  );
  live();
  if (!value) fail("binding");
  const snapshot = await validateBrowserSigningSnapshot(
    value,
    value.namespace.owner
  );
  live();
  if (
    !phases.has(snapshot.journal.phase) ||
    snapshot.query.namespace !== locator.namespace ||
    snapshot.query.queryId !== locator.queryId ||
    snapshot.journal.sessionId !== locator.sessionId ||
    snapshot.journal.requestId !== locator.requestId ||
    snapshot.original.requestId !== locator.requestId ||
    snapshot.original.queryId !== locator.queryId ||
    snapshot.original.namespace !== locator.namespace ||
    snapshot.journal.payment.kind !== "fetch" ||
    snapshot.namespace.network !== "eip155:5042002" ||
    snapshot.journal.requirements.asset.toLowerCase() !==
      "0x3600000000000000000000000000000000000000"
  )
    fail("binding");
  return snapshot;
}
function nonce(value: string) {
  return value.toLowerCase().replace(/^0x/, "");
}
function matches(t: Transfer, s: BrowserSigningSnapshot) {
  const a = s.original.authorization;
  return (
    nonce(t.nonce) === nonce(a.nonce) &&
    t.fromAddress.toLowerCase() === a.from &&
    t.toAddress.toLowerCase() === a.to &&
    t.amount === a.value &&
    t.sendingNetwork === "eip155:5042002" &&
    t.recipientNetwork === "eip155:5042002"
  );
}
async function search(
  snapshot: BrowserSigningSnapshot,
  life: ReturnType<typeof lifetime>
) {
  const base = new URL(ENDPOINT),
    a = snapshot.original.authorization;
  for (const [key, value] of Object.entries({
    from: a.from,
    to: a.to,
    network: "eip155:5042002",
    token: "USDC",
    nonce: a.nonce,
    pageSize: "50",
  }))
    base.searchParams.set(key, value);
  let cursor: string | undefined,
    bytes = 0,
    matchedAt: number | undefined,
    observedAt: string | undefined;
  const seen = new Set<string>(),
    found: Transfer[] = [];
  for (let page = 0; page < 4; page++) {
    life.live();
    const url = new URL(base);
    if (cursor) url.searchParams.set("pageAfter", cursor);
    const started = now(),
      requestStop = new AbortController(),
      timer = setTimeout(() => requestStop.abort(), REQUEST_MS);
    const signal = AbortSignal.any([life.stop.signal, requestStop.signal]);
    const live = () => {
      life.live();
      if (signal.aborted || now() - started >= REQUEST_MS) fail("deadline");
    };
    try {
      const response = await fetchRead(url, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal,
        headers: { Accept: "application/json" },
      });
      live();
      if (!response.ok || response.redirected || !response.body) {
        void response.body?.cancel().catch(() => {});
        fail("provider");
      }
      const declared = response.headers.get("content-length");
      if (
        declared !== null &&
        (!/^[0-9]{1,12}$/.test(declared) ||
          Number(declared) > MAX_BYTES - bytes)
      ) {
        void response.body.cancel().catch(() => {});
        fail("incomplete");
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          live();
          if (part.done) break;
          size += part.value.length;
          bytes += part.value.length;
          if (bytes > MAX_BYTES) fail("incomplete");
          chunks.push(part.value);
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      const body = z
        .object({ transfers: z.array(transferSchema).max(50) })
        .strict()
        .parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined))
        );
      live();
      for (const transfer of body.transfers)
        if (nonce(transfer.nonce) === nonce(a.nonce)) {
          if (!matches(transfer, snapshot)) fail("binding");
          found.push(transfer);
          if (matchedAt === undefined) {
            matchedAt = now();
            observedAt = new Date().toISOString();
          }
        }
      const link = response.headers.get("Link");
      cursor = undefined;
      if (link) {
        if (link.length > 4096) fail("incomplete");
        const relations = new Set<string>();
        for (const part of link.split(",")) {
          const match = part.match(
            /^\s*<([^>]+)>\s*;\s*rel="(self|first|prev|next)"\s*$/
          );
          if (!match || relations.has(match[2])) fail("incomplete");
          relations.add(match[2]);
          const target = new URL(match[1]);
          if (
            target.origin !== base.origin ||
            target.pathname !== base.pathname
          )
            fail("incomplete");
          if (match[2] === "next") {
            cursor = target.searchParams.get("pageAfter") ?? undefined;
            if (!cursor || cursor.length > 256 || seen.has(cursor))
              fail("incomplete");
            seen.add(cursor);
          }
        }
      }
      if (!cursor) {
        if (
          found.length !== 1 ||
          matchedAt === undefined ||
          observedAt === undefined
        )
          fail(found.length ? "binding" : "provider");
        return { transfer: found[0], matchedAt, observedAt };
      }
    } catch (error) {
      if (signal.aborted) fail("deadline");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  return fail("incomplete");
}
function fresh(matchedAt: number) {
  const age = now() - matchedAt;
  if (!Number.isFinite(age) || age < 0 || age >= TTL_MS) fail("deadline");
}
/** Facts only. Historical expiry/revocation does not confer private body access. */
export async function observeBrowserX402Settlement(
  value: BrowserX402SettlementLocator
): Promise<BrowserX402ObservationResult> {
  const started = now();
  try {
    const locator = capture(value);
    return await bounded(async (life) => {
      life.live();
      const adapter = await getDb();
      life.live();
      const before = await read(adapter, locator, life.live),
        bound = fingerprint(before);
      const observed = await search(before, life);
      life.live();
      fresh(observed.matchedAt);
      if (
        locator.transferIdHint &&
        observed.transfer.id !== locator.transferIdHint
      )
        fail("binding");
      const after = await read(adapter, locator, life.live);
      if (fingerprint(after) !== bound) fail("binding");
      const evidence: BrowserX402TransferObservation = Object.freeze({
        format: "browser-x402-transfer-observation-v1",
        basis: "circle-api",
        chainFinality: "not-verified",
        backendTrust: "installed-runtime-adapter",
        scope: "nonce-filtered-returned-api-pages",
        namespace: locator.namespace,
        queryId: locator.queryId,
        requestId: locator.requestId,
        originalDigest: hash(before.original),
        queryProofDigest: before.query.proofDigest,
        observedAt: observed.observedAt,
        transfer: Object.freeze({ ...observed.transfer }),
      });
      const token = Object.freeze({}) as VerifiedBrowserX402TransferObservation;
      life.live();
      fresh(observed.matchedAt);
      records.set(token, {
        locator: canonicalJson(locator),
        adapter,
        fingerprint: bound,
        matchedAt: observed.matchedAt,
        evidence,
      });
      return { status: "observed", token } as const;
    }, TOTAL_MS - (now() - started));
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Unavailable ? error.reason : "provider",
    };
  }
}
export async function unsealBrowserX402TransferObservation(
  token: VerifiedBrowserX402TransferObservation,
  value: BrowserX402SettlementLocator
): Promise<BrowserX402TransferObservation> {
  const locator = capture(value),
    record = records.get(token);
  if (!record || record.locator !== canonicalJson(locator)) fail("binding");
  fresh(record.matchedAt);
  return bounded(async (life) => {
    const adapter = await getDb();
    life.live();
    if (adapter !== record.adapter) fail("binding");
    fresh(record.matchedAt);
    if (
      fingerprint(await read(adapter, locator, life.live)) !==
      record.fingerprint
    )
      fail("binding");
    life.live();
    fresh(record.matchedAt);
    return record.evidence;
  }, TTL_MS - (now() - record.matchedAt));
}
