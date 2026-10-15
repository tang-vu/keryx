import { createHash } from "node:crypto";
import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import { privateResearchIdSchema } from "../a2a/private-research-intent";
import { privatePaymentState } from "../a2a/private-payment-state";
import { privateRequestSchema, matchesPrivateRequestCommitment } from "../buyer/private-request-commitment";
import { authorizationSchema, requirementSchema } from "../buyer/protocol";
import { privateMerchantPolicySchema, requirePrivateMerchant } from "../buyer/private-merchant-policy";
import { boundedPortableCopy } from "../research/bounded-portable-json";
import { parseRunProvenance } from "../research/run-provenance";
import { HistoryError, historyWallet } from "./personal-history";
import { PRIVATE_JOB_HISTORY_BOUNDS as B, PRIVATE_JOB_HISTORY_QUALIFICATION,
  privateJobHistoryCapabilities, privateJobHistoryCursorSchema, privateJobHistoryRowSchema,
  privateJobHistoryPageSchema, privateJobHistoryExportSchema, privateJobHistoryDetailSchema, privateJobFinalizedRunSchema,
  privateJobPositionSchema, privateJobDateSchema, parsePrivateJobHistoryInput,
  comparePrivateJobPosition, privateJobTime,
  type PrivateJobHistoryInput, type PrivateJobHistoryRow, type PrivateJobHistoryExport, type PrivateJobPosition } from "./private-job-history-contract";

/** Only existing exact-payer READ ports. No privacy/public-run/membership/creator-ledger dependency. */
export type PrivateJobHistoryDB = Pick<KeryxDB, "listPrivateResearchHistory" | "getPrivateResearchIntent" |
  "getPrivateResearchResult" | "getPrivateResearchExecution" | "getPrivatePaymentState">;
export interface PrivateJobHistoryReadOptions { signal?: AbortSignal; deadline?: number }
const unavailable = () => new HistoryError("history_unavailable");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const intentSchema = z.object({ id: privateResearchIdSchema,
  submission: z.object({ request: privateRequestSchema, salt: z.string().regex(/^0x[a-f0-9]{64}$/),
    payment: z.object({ authorization: authorizationSchema, signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/) }).strict() }).strict(),
  requirement: requirementSchema, merchants: privateMerchantPolicySchema,
}).strict();
const claimSchema = z.object({ id: privateResearchIdSchema, workerId: z.string().uuid(), startedAt: privateJobDateSchema }).strict();
const savedSchema = z.object({ id: privateResearchIdSchema, format: z.literal("query-run-v1"),
  serializedRun: z.string().min(2).max(B.recordBytes), savedAt: privateJobDateSchema }).strict();
const paymentSchema = z.discriminatedUnion("status", [
  z.object({ id: privateResearchIdSchema, startedAt: privateJobDateSchema, status: z.literal("pending"), confirmation: z.null(), settledAt: z.null() }).strict(),
  z.object({ id: privateResearchIdSchema, startedAt: privateJobDateSchema, status: z.literal("settled"), confirmation: z.unknown(), settledAt: privateJobDateSchema }).strict(),
]);
type BoundRecord = { id: string; intent: string; claim: string; payment: string; saved: string };

function readPorts(db: PrivateJobHistoryDB): PrivateJobHistoryDB {
  const names = ["listPrivateResearchHistory", "getPrivateResearchIntent", "getPrivateResearchResult", "getPrivateResearchExecution", "getPrivatePaymentState"] as const;
  // Permit ordinary class methods, refuse missing/accessor capabilities before private IO.
  const ports: Partial<PrivateJobHistoryDB> = {};
  for (const name of names) {
    let object: object | null = db, descriptor: PropertyDescriptor | undefined;
    for (let depth = 0; object && depth < 8; depth++, object = Object.getPrototypeOf(object)) {
      descriptor = Object.getOwnPropertyDescriptor(object, name);
      if (descriptor) break;
    }
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") throw unavailable();
    Object.defineProperty(ports, name, { value: descriptor.value.bind(db), enumerable: true });
  }
  return ports as PrivateJobHistoryDB;
}
function operation(options: PrivateJobHistoryReadOptions, maxMs: number) {
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + maxMs);
  if (!Number.isFinite(deadline)) throw unavailable();
  const check = () => { if (options.signal?.aborted || Date.now() >= deadline) throw unavailable(); };
  check();
  let rejectStop!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  // A stop can happen between awaits; retain a rejection handler until the operation ends.
  void stopped.catch(() => undefined);
  const stop = () => rejectStop(unavailable());
  const timer = setTimeout(stop, Math.max(0, deadline - Date.now()));
  options.signal?.addEventListener("abort", stop, { once: true });
  return { check, async read<T>(read: () => Promise<T>): Promise<T> {
    check(); const value = await Promise.race([Promise.resolve().then(read), stopped]); check(); return value;
  }, dispose() { clearTimeout(timer); options.signal?.removeEventListener("abort", stop); } };
}
type Operation = ReturnType<typeof operation>;
async function checkedIntent(raw: unknown, owner: string, op: Operation): Promise<PrivateResearchIntent> {
  const value = intentSchema.parse(boundedPortableCopy(raw, 65536));
  const a = value.submission.payment.authorization;
  if (a.from !== owner || a.to !== a.to.toLowerCase()) throw unavailable();
  requirePrivateMerchant(value.requirement, value.merchants);
  const id = `prv_${createHash("sha256").update(["keryx-private-order-v1", value.requirement.network, a.from, a.to, a.nonce].join("|")).digest("hex")}`;
  if (id !== value.id || !await op.read(() => matchesPrivateRequestCommitment(value.submission.request,
    value.requirement, a, value.submission.salt))) throw unavailable();
  // The established DB adapters already verify the stored EOA signature. This is a consistency
  // fence, never owner authentication or a replacement adapter admitting unsigned records.
  return value;
}
async function resolveRecord(db: PrivateJobHistoryDB, owner: string, id: string, op: Operation,
  listedIntent?: PrivateResearchIntent, position?: PrivateJobPosition) {
  const rawIntent = await op.read(() => db.getPrivateResearchIntent(id, owner));
  if (rawIntent === null) { if (listedIntent) throw unavailable(); return null; }
  const intent = await checkedIntent(rawIntent, owner, op);
  if (intent.id !== id || listedIntent && hash(intent) !== hash(listedIntent)) throw unavailable();
  const rawPayment = await op.read(() => db.getPrivatePaymentState(id, owner));
  const payment = rawPayment === null ? null : paymentSchema.parse(boundedPortableCopy(rawPayment, 16384));
  if (payment && payment.id !== id) throw unavailable();
  const validatedPayment = payment && privatePaymentState({ started_at: payment.startedAt,
    confirmation: payment.confirmation, settled_at: payment.settledAt }, intent);
  const rawClaim = await op.read(() => db.getPrivateResearchExecution(id, owner));
  const claim = rawClaim === null ? null : claimSchema.parse(boundedPortableCopy(rawClaim, 1024));
  if (claim && claim.id !== id) throw unavailable();
  const rawSaved = await op.read(() => db.getPrivateResearchResult(id, owner));
  if (rawSaved === null) {
    if (claim && validatedPayment?.status !== "settled") throw unavailable();
    return null; // An intent, payment or permanent execution claim alone is not a completed run.
  }
  const saved = savedSchema.parse(boundedPortableCopy(rawSaved, B.recordBytes + 16384));
  if (!claim || validatedPayment?.status !== "settled" || saved.id !== id
    || Buffer.byteLength(saved.serializedRun, "utf8") > B.recordBytes) throw unavailable();
  const rawRun = boundedPortableCopy(JSON.parse(saved.serializedRun), B.recordBytes);
  const run = privateJobFinalizedRunSchema.parse(rawRun), request = intent.submission.request;
  if (run.id !== id || run.question !== request.question || run.budget !== request.budget || run.researchMode !== request.researchMode
    || run.asker !== undefined && run.asker !== owner
    || run.decisions.some(d => d.targets.some(i => i >= run.subClaims.length))
    || [...(run.evidence ?? []), ...(run.claimCoverage ?? [])].some(e => run.subClaims[e.claimIndex] !== e.claim)) throw unavailable();
  // Existing storage binds result insertion to this permanent worker claim. Saved snapshots have
  // no worker stamp; retain and revalidate the claim instead of inventing a future storage field.
  const binding: BoundRecord = { id, intent: hash(intent), claim: hash(claim),
    payment: hash(validatedPayment), saved: hash(saved) };
  const confirmation = validatedPayment.confirmation;
  const row = privateJobHistoryRowSchema.parse({ id, ownerWallet: owner,
    createdAt: run.createdAt, intentCreatedAt: position?.createdAt ?? null, savedAt: saved.savedAt, question: request.question,
    researchMode: request.researchMode, model: request.model, packageVersion: request.packageVersion,
    record: "finalized-private-result", provenance: parseRunProvenance((rawRun as Record<string, unknown>).provenance) ?? null,
    incomingSettlement: { status: "settled", amountMicros: confirmation.amountMicros, network: confirmation.network,
      reference: confirmation.transaction, settledAt: validatedPayment.settledAt,
      evidenceSource: confirmation.source, chainFinalityVerified: false },
    ownSettledSpendMicros: null, creatorRewardsMicros: null, paidCreators: null,
  });
  const { answer, engine, createdAt, subClaims, decisions, citations, evidence, claimCoverage } = run;
  return { row, binding, result: { answer, engine, createdAt, savedAt: saved.savedAt, subClaims, decisions,
    citations: citations.map(({ reward, ...citation }) => ({ ...citation, recordedRewardUsdc: reward })),
    evidence: evidence ?? null, claimCoverage: claimCoverage ?? null, paymentEvidence: "incoming-only-no-creator-ledger" as const } };
}
async function fence(db: PrivateJobHistoryDB, owner: string, bindings: readonly BoundRecord[], op: Operation) {
  for (const previous of bindings) {
    // Compare exact immutable snapshots, including signature bytes and worker identity.
    const intent = await checkedIntent(await op.read(() => db.getPrivateResearchIntent(previous.id, owner)), owner, op);
    const claim = boundedPortableCopy(await op.read(() => db.getPrivateResearchExecution(previous.id, owner)), 1024);
    const payment = boundedPortableCopy(await op.read(() => db.getPrivatePaymentState(previous.id, owner)), 16384);
    const saved = boundedPortableCopy(await op.read(() => db.getPrivateResearchResult(previous.id, owner)), B.recordBytes + 16384);
    if (hash(intent) !== previous.intent || hash(claim) !== previous.claim || hash(payment) !== previous.payment || hash(saved) !== previous.saved) throw unavailable();
  }
  op.check();
}
function envelope(owner: string) {
  return { format: "private-job-history-v1" as const, wallet: owner, scope: "exact-payer-private-current-store" as const,
    capabilities: privateJobHistoryCapabilities, qualification: PRIVATE_JOB_HISTORY_QUALIFICATION };
}
function cursorFor(owner: string, query: string, upper: PrivateJobPosition, before: PrivateJobPosition) {
  return Buffer.from(JSON.stringify(privateJobHistoryCursorSchema.parse({ format: "private-job-history-cursor-v1",
    owner: hash(["exact-payer-private-current-store", owner]), query, upper, before }))).toString("base64url");
}
async function page(db: PrivateJobHistoryDB, owner: string, rawInput: PrivateJobHistoryInput, op: Operation) {
  let input;
  try { input = parsePrivateJobHistoryInput(rawInput); } catch { throw new HistoryError("invalid_history_query"); }
  const { cursor, ...filters } = input, query = hash(filters);
  let upper: PrivateJobPosition | undefined, before: PrivateJobPosition | undefined;
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, "base64url");
      if (decoded.toString("base64url") !== cursor) throw new Error();
      const parsed = privateJobHistoryCursorSchema.parse(boundedPortableCopy(JSON.parse(decoded.toString("utf8")), 4096));
      if (parsed.owner !== hash(["exact-payer-private-current-store", owner]) || parsed.query !== query) throw new Error();
      upper = parsed.upper; before = parsed.before;
    } catch { throw new HistoryError("invalid_history_query"); }
  }
  const raw = boundedPortableCopy(await op.read(() => db.listPrivateResearchHistory(owner, before)), B.recordBytes);
  if (!Array.isArray(raw) || raw.length > B.candidates) throw unavailable();
  const candidates: { intent: PrivateResearchIntent; position: PrivateJobPosition }[] = [];
  for (const entry of raw) {
    const parsed = z.object({ intent: z.unknown(), createdAt: privateJobDateSchema }).strict().parse(entry);
    const intent = await checkedIntent(parsed.intent, owner, op);
    const position = privateJobPositionSchema.parse({ id: intent.id, createdAt: parsed.createdAt });
    const previous = candidates.at(-1)?.position;
    if (previous && comparePrivateJobPosition(position, previous) >= 0
      || before && comparePrivateJobPosition(position, before) >= 0
      || upper && comparePrivateJobPosition(position, upper) > 0
      || candidates.some(c => c.intent.id === intent.id)) throw unavailable();
    candidates.push({ intent, position });
  }
  upper ??= candidates[0]?.position;
  const rows: PrivateJobHistoryRow[] = [], bindings: BoundRecord[] = [];
  let scanned = 0, size = 0, last: PrivateJobPosition | undefined;
  for (const candidate of candidates.slice(0, B.scan)) {
    const found = await resolveRecord(db, owner, candidate.intent.id, op, candidate.intent, candidate.position);
    // Validate ALL visited records before applying literal question/date/provenance filters.
    const matches = found && (filters.search === undefined || found.row.question.includes(filters.search))
      && (!filters.from || privateJobTime(candidate.position.createdAt) >= privateJobTime(filters.from))
      && (!filters.to || privateJobTime(candidate.position.createdAt) <= privateJobTime(filters.to))
      && (!filters.surface || (found.row.provenance?.surface ?? "unknown") === filters.surface)
      && (!filters.network || found.row.incomingSettlement.network === filters.network);
    if (found && matches) {
      const rowBytes = bytes(found.row);
      if (size + rowBytes > B.pageBytes - 8192) { if (!rows.length) throw unavailable(); break; }
      size += rowBytes; rows.push(found.row); bindings.push(found.binding);
    }
    scanned++; last = candidate.position;
    if (rows.length === filters.limit) break;
  }
  await fence(db, owner, bindings, op);
  const more = scanned < candidates.length;
  const nextCursor = more && upper && last ? cursorFor(owner, query, upper, last) : null;
  const value = privateJobHistoryPageSchema.parse({ ...envelope(owner), rows, nextCursor,
    scanLimited: more && rows.length < filters.limit, scannedIntents: scanned });
  if (bytes(value) > B.pageBytes) throw unavailable();
  return { value, bindings };
}
async function perform<T>(db: PrivateJobHistoryDB, owner: string, options: PrivateJobHistoryReadOptions,
  maxMs: number, read: (ports: PrivateJobHistoryDB, wallet: string, op: Operation) => Promise<T>): Promise<T> {
  const op = operation(options, maxMs);
  try { const value = await read(readPorts(db), historyWallet(owner), op); op.check(); return value; }
  catch (error) { if (error instanceof HistoryError) throw error; throw unavailable(); }
  finally { op.dispose(); }
}
/** The caller MUST independently authenticate owner. An ID, label or backend signer is no proof. */
export function readPrivateJobHistory(db: PrivateJobHistoryDB, owner: string, input: PrivateJobHistoryInput = {}, options: PrivateJobHistoryReadOptions = {}) {
  return perform(db, owner, options, B.readMs, async (ports, wallet, op) => (await page(ports, wallet, input, op)).value);
}
export function readPrivateJobHistoryDetail(db: PrivateJobHistoryDB, owner: string, rawId: string, options: PrivateJobHistoryReadOptions = {}) {
  return perform(db, owner, options, B.readMs, async (ports, wallet, op) => {
    let id; try { id = privateResearchIdSchema.parse(rawId); } catch { throw new HistoryError("invalid_history_query"); }
    const found = await resolveRecord(ports, wallet, id, op);
    if (!found) return null;
    await fence(ports, wallet, [found.binding], op);
    const value = privateJobHistoryDetailSchema.parse({ ...envelope(wallet), row: found.row, result: found.result });
    if (bytes(value) > B.detailBytes) throw unavailable();
    return value;
  });
}
/** Explicit bounded metadata export, preserving the same query/limit binding on every page. */
export function exportPrivateJobHistory(db: PrivateJobHistoryDB, owner: string, input: PrivateJobHistoryInput = {}, options: PrivateJobHistoryReadOptions = {}) {
  return perform(db, owner, options, B.exportMs, async (ports, wallet, op) => {
    let parsed;
    try { parsed = parsePrivateJobHistoryInput(input); } catch { throw new HistoryError("invalid_history_query"); }
    const { cursor: initial, ...filters } = parsed;
    const rows: PrivateJobHistoryRow[] = [], bindings: BoundRecord[] = [], seen = new Set<string>();
    let cursor = initial, nextCursor: string | null = initial ?? null, complete = false, pages = 0, size = 0;
    for (; pages < B.exportPages;) {
      const current = await page(ports, wallet, { ...filters, ...(cursor ? { cursor } : {}) }, op);
      pages++;
      const added = bytes(current.value.rows);
      if (rows.length + current.value.rows.length > B.exportRows || size + added > B.exportBytes - 16384) {
        if (!rows.length) throw unavailable();
        break; // Previous continuation revisits the entire omitted page; never skip rows.
      }
      for (const row of current.value.rows) { if (seen.has(row.id)) throw unavailable(); seen.add(row.id); }
      size += added; rows.push(...current.value.rows); bindings.push(...current.bindings);
      nextCursor = current.value.nextCursor;
      if (!nextCursor) { complete = true; break; }
      if (nextCursor === cursor) throw unavailable();
      cursor = nextCursor;
    }
    await fence(ports, wallet, bindings, op);
    const value = privateJobHistoryExportSchema.parse({ ...envelope(wallet), rows, nextCursor, complete, truncated: !complete, pages,
      bounds: { maxPages: B.exportPages, maxRows: B.exportRows, maxBytes: B.exportBytes } });
    if (bytes(value) > B.exportBytes) throw unavailable();
    return value;
  });
}
function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function privateJobHistoryCsv(value: PrivateJobHistoryExport) {
  const parsed = privateJobHistoryExportSchema.parse(value);
  const fields = ["id", "createdAt", "intentCreatedAt", "savedAt", "question", "researchMode", "model", "provenance", "incomingSettlement", "ownSettledSpendMicros", "creatorRewardsMicros", "paidCreators"] as const;
  const lines = [["record", ...fields].map(csvCell).join(","),
    ["metadata", JSON.stringify({ wallet: parsed.wallet, scope: parsed.scope, complete: parsed.complete,
      truncated: parsed.truncated, nextCursor: parsed.nextCursor, bounds: parsed.bounds, capabilities: parsed.capabilities,
      qualification: parsed.qualification }), ...Array(fields.length - 1).fill("")].map(csvCell).join(","),
    ...parsed.rows.map(row => [row.record, ...fields.map(field => row[field])].map(csvCell).join(","))];
  const csv = lines.join("\r\n") + "\r\n";
  if (Buffer.byteLength(csv) > B.exportBytes) throw unavailable();
  return csv;
}
