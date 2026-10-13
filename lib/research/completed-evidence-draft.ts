import { createHash } from "node:crypto";
import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { privateWorkspaceResultSchema } from "../a2a/private-workspace";
import { extractAnswerMarkers, MIN_REWARD_SUPPORT } from "../agent/evidence-ledger";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { boundedPortableCopy } from "./bounded-portable-json";
import { hasKnownSeedFingerprint } from "./seed-evidence-fingerprints";
import { SEED_EVIDENCE_FINGERPRINTS } from "./seed-evidence-fingerprints";
import { literatureWorkspaceSchema } from "../papers/literature-workspace";
import { assembleEvidenceDraftRequest, buildEvidenceDraft, evidenceDraftReportSchema, evidenceDraftWorkspace,
  parseEvidenceDraftRequest, retainedDraftExcerpts, type EvidenceDraftRequest } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";

export const COMPLETED_READ_CAPABILITY = "owned-private-completed-read-v1" as const;
export const MAX_COMPLETED_SNAPSHOT_BYTES = 262_144;
export const COMPLETED_READ_DEADLINE_MS = 5000;
const text = (max: number, min = 1) => z.string().min(min).max(max).refine(isWellFormedUtf16);
const identifier = text(200).refine(value => value === value.trim() && !/[<>"\s\\\u0000-\u001f\u007f-\u009f]/u.test(value));
const owner = z.string().regex(/^0x[a-f0-9]{40}$/).refine(value => !/^0x0{40}$/.test(value));
const jobId = z.string().regex(/^prv_[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const unit = z.number().finite().min(0).max(1);
const https = z.string().min(1).max(2048).url().refine(isWellFormedUtf16).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port
    && !/[<>"\s\\\u0000-\u001f\u007f-\u009f]/u.test(value);
});
// Existing article-reader uses a bare raw-body digest; creator assets use
// sha256:<identity digest> or ipfs:<CID>. Preserve their distinct representations.
const version = z.string().min(1).max(200).regex(/^(?:[a-f0-9]{64}|sha256:[a-f0-9]{64}|ipfs:(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120}))$/).refine(isWellFormedUtf16);
const exactIdentity = { sourceId: identifier, itemId: identifier, itemUrl: https, contentVersion: version };
export const completedReadSelectionSchema = z.object({
  id: jobId, savedAt: date, snapshotSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  question: text(4000), budget: z.number().finite().positive().max(0.5), researchMode: z.enum(["quick", "deep"]),
  sources: z.array(z.object(exactIdentity).strict()).min(1).max(50),
}).strict();
export type CompletedReadSelection = z.infer<typeof completedReadSelectionSchema>;
export const completedEvidenceDraftRequestSchema = z.object({
  version: z.literal(1), capability: z.literal(COMPLETED_READ_CAPABILITY),
  baseUrl: text(2048), network: text(80), selection: completedReadSelectionSchema,
  workspace: literatureWorkspaceSchema,
}).strict();
export type CompletedEvidenceDraftRequest = z.infer<typeof completedEvidenceDraftRequestSchema>;
export type CompletedResultReader = Pick<KeryxDB, "getPrivateResearchIntent" | "getPrivateResearchExecution"
  | "getPrivateResearchResult" | "getPrivateResearchInterruption">;
export interface CompletedReadContext { db: CompletedResultReader; wallet: string; baseUrl: string; network: string }
export class CompletedReadRefusal extends Error {
  constructor(public readonly kind: "changed" | "storage") { super("Completed private read unavailable"); }
}

// These are projections of existing fields, never additions to a receipt or stored run.
const receipt = z.object({ bodyHash: z.string().regex(/^0x[a-f0-9]{64}$/).optional(),
  deliveryKind: z.enum(["full_text", "excerpt", "abstract", "metadata_only"]),
  storageMode: z.enum(["ipfs_encrypted", "db_encrypted", "db_plaintext"]),
  plaintextBytes: z.number().int().nonnegative().max(16 * 1024 * 1024),
  manifestId: text(200).optional(), manifestSigner: text(200).optional(), manifest: z.unknown().optional() }).strict();
const web = z.object({ retrievedAt: date, publisherGroup: text(200), normalizedBodyHash: text(80),
  extraction: z.enum(["html", "text", "pdf"]), truncated: z.boolean() }).strict();
const identity = {
  sourceId: identifier, sourceName: text(1000), marker: z.string().regex(/^S[1-9]\d{0,2}$/),
  itemId: identifier.optional(), itemTitle: text(1000).optional(), itemUrl: https.optional(), contentVersion: version.optional(),
  itemPublishedAt: text(100).optional(), evidenceProvenance: z.literal("synthetic-demo").optional(),
  contentReceipt: receipt.optional(), webProvenance: web.optional(), sourceKind: z.literal("public-reference").optional(),
  publicDeliveryKind: z.enum(["full_text", "excerpt", "abstract", "metadata_only"]).optional(),
  requestedSource: z.object({ urls: z.array(https).max(50), readScope: z.literal("bounded-whole-document") }).strict().optional(),
  sourceClaim: z.object({ id: text(200), revision: z.number().int().nonnegative(), mode: z.enum(["free", "citation-only", "paid"]),
    effectiveAt: date, verifiedAt: date }).strict().optional(),
  accessKind: z.literal("creator-free").optional(), scholarly: z.unknown().optional(),
};
const citationSchema = z.object({ ...identity, weight: unit, reward: unit, rationale: text(4000, 0) }).strict();
const evidenceSchema = z.object({ ...identity, claimIndex: z.number().int().min(0).max(63), claim: text(4000),
  quote: text(240, 8), support: unit, qualifiesForAnswer: z.boolean().optional(), qualifiesForReward: z.boolean() }).strict();
const runSchema = z.object({ id: jobId, question: text(4000), budget: z.number().finite().positive().max(0.5),
  researchMode: z.enum(["quick", "deep"]), asker: owner,
  origin: z.literal("a2a"), paymentMode: z.literal("real"), fundingOwner: z.literal("treasury"),
  answer: text(12000), engine: text(200), createdAt: date,
  subClaims: z.array(text(4000)).min(1).max(64), citations: z.array(citationSchema).max(64),
  evidence: z.array(evidenceSchema).max(256).optional(),
  decisions: z.array(z.object({ sourceId: identifier, sourceName: text(1000), action: z.enum(["BUY", "SKIP", "CACHE"]),
    rationale: text(4000, 0), price: z.number().finite().nonnegative().max(1), targets: z.array(z.number().int().min(0).max(63)).max(64),
  }).passthrough()).max(256),
  claimCoverage: z.array(z.object({ claimIndex: z.number().int().min(0).max(63), claim: text(4000), coverage: unit,
    coveredBy: z.array(text(80)).max(64) }).strict()).max(64).optional(),
}).passthrough();
type SavedRun = z.infer<typeof runSchema>;
type RetainedRow = z.infer<typeof evidenceSchema>;
const digest = (raw: string) => `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
const exact = (a: Partial<CompletedReadSelection["sources"][number]>, b: Partial<CompletedReadSelection["sources"][number]>) =>
  ["sourceId", "itemId", "itemUrl", "contentVersion"].every(key => a[key as keyof typeof a] === b[key as keyof typeof b]);
const unique = (rows: readonly string[]) => new Set(rows).size === rows.length;
const seed = (row: RetainedRow | z.infer<typeof citationSchema>) => row.evidenceProvenance === "synthetic-demo"
  || hasKnownSeedFingerprint(row.itemTitle, row.itemUrl, row.contentReceipt?.bodyHash)
  // A known seed identity stays excluded when a historical receipt lacks its hash.
  || SEED_EVIDENCE_FINGERPRINTS.some(value => value.itemUrl === row.itemUrl);

function retainedBodyBinding(row: RetainedRow, citation: z.infer<typeof citationSchema>): boolean {
  if (row.contentReceipt && citation.contentReceipt) {
    return row.contentReceipt.deliveryKind !== "metadata_only" && !!row.contentReceipt.bodyHash
      && row.contentReceipt.plaintextBytes >= new TextEncoder().encode(row.quote).length
      && JSON.stringify(row.contentReceipt) === JSON.stringify(citation.contentReceipt);
  }
  if (row.webProvenance && citation.webProvenance) {
    // article-reader retains raw digest(text) as version and a DIFFERENT
    // digest(NFKC + whitespace normalization) as normalizedBodyHash.
    return /^[a-f0-9]{64}$/.test(row.webProvenance.normalizedBodyHash)
      && /^[a-f0-9]{64}$/.test(row.contentVersion ?? "")
      && JSON.stringify(row.webProvenance) === JSON.stringify(citation.webProvenance);
  }
  return false;
}

/** Validate the persisted completion using the existing private result projection
 * contract as well as the stronger URL/identity/ledger bounds needed here. Never
 * run the evidence engine: its full gathered body was not persisted in QueryRun. */
function checkedRun(raw: string, savedAt: string, selection: CompletedReadSelection, wallet: string): SavedRun {
  if (raw.length > MAX_COMPLETED_SNAPSHOT_BYTES || !isWellFormedUtf16(raw)
    || new TextEncoder().encode(raw).length > MAX_COMPLETED_SNAPSHOT_BYTES || digest(raw) !== selection.snapshotSha256) throw new Error();
  const run = runSchema.parse(boundedPortableCopy(JSON.parse(raw), MAX_COMPLETED_SNAPSHOT_BYTES));
  if (run.id !== selection.id || run.question !== selection.question || run.budget !== selection.budget
    || run.researchMode !== selection.researchMode || run.asker !== wallet
    || Date.parse(run.createdAt) > Date.parse(savedAt)
    || run.decisions.some(row => row.targets.some(index => index >= run.subClaims.length))
    || [...(run.evidence ?? []), ...(run.claimCoverage ?? [])].some(row => run.subClaims[row.claimIndex] !== row.claim)
    || !unique(run.citations.map(row => row.marker))
    || !unique(run.citations.map(row => JSON.stringify([row.sourceId, row.itemId, row.itemUrl, row.contentVersion])))
    || !unique((run.evidence ?? []).map(row => JSON.stringify([row.marker, row.claimIndex, row.quote])))) throw new Error();
  // No payment reference is used as evidence. This is the existing completion
  // result schema only; the spend/receipt projection remains on its own route.
  // Zod 3 refinements wrap the object twice. Unwrap both through the supported
  // API, retaining the existing result contract and its concrete object type.
  privateWorkspaceResultSchema.innerType().innerType().shape.result.unwrap().parse({ ...run, savedAt,
    citations: run.citations.map(row => ({ ...row, recordedRewardUsdc: row.reward })),
    evidence: run.evidence ?? null, claimCoverage: run.claimCoverage ?? null });
  if (run.citations.some(seed) || (run.evidence ?? []).some(seed)) throw new Error();
  return run;
}

/** Fixed finite read graph against the session-selected adapter. No dispatch,
 * source-body/cache/archive lookup, write port, role creation or storage fallback. */
export async function loadCompletedEvidenceDraft(context: CompletedReadContext, value: unknown) {
  const input = completedEvidenceDraftRequestSchema.parse(boundedPortableCopy(value, 65536));
  const wallet = owner.parse(context.wallet), { selection } = input;
  const { db, baseUrl, network } = context;
  const workspace = evidenceDraftWorkspace(input.workspace);
  if (input.baseUrl !== baseUrl || input.network !== network
    || !unique(selection.sources.map(row => row.itemUrl))
    || selection.sources.some(row => !workspace.entries.some(entry => entry.paper.url === row.itemUrl)))
    throw new CompletedReadRefusal("changed");
  for (const method of ["getPrivateResearchIntent", "getPrivateResearchExecution", "getPrivateResearchResult", "getPrivateResearchInterruption"] as const)
    if (typeof db[method] !== "function") throw new CompletedReadRefusal("storage");
  const until = Date.now() + COMPLETED_READ_DEADLINE_MS;
  // An underlying adapter read cannot be cancelled through these existing ports.
  // A timed-out read emits no packet and never starts the next read.
  const read = async <T,>(operation: () => Promise<T>): Promise<T> => {
    const remaining = until - Date.now();
    if (remaining <= 0) throw new CompletedReadRefusal("storage");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CompletedReadRefusal("storage")), remaining);
    })]); } catch { throw new CompletedReadRefusal("storage"); } finally { clearTimeout(timer); }
  };
  const capture = async () => {
    const intent = await read(() => db.getPrivateResearchIntent(selection.id, wallet));
    if (!intent || intent.id !== selection.id || intent.submission.payment.authorization.from !== wallet
      || intent.requirement.network !== network || intent.submission.request.question !== selection.question
      || intent.submission.request.budget !== selection.budget || intent.submission.request.researchMode !== selection.researchMode)
      throw new CompletedReadRefusal("changed");
    const intentSnapshot = JSON.stringify(boundedPortableCopy(intent, 16384));
    const claim = await read(() => db.getPrivateResearchExecution(selection.id, wallet));
    if (!claim || claim.id !== selection.id || !z.string().uuid().safeParse(claim.workerId).success
      || !date.safeParse(claim.startedAt).success || Date.parse(claim.startedAt) > Date.parse(selection.savedAt))
      throw new CompletedReadRefusal("changed");
    const claimSnapshot = JSON.stringify(claim), startedAt = claim.startedAt;
    if (await read(() => db.getPrivateResearchInterruption(selection.id, wallet))) throw new CompletedReadRefusal("changed");
    const saved = await read(() => db.getPrivateResearchResult(selection.id, wallet));
    if (!saved || saved.id !== selection.id || saved.format !== "query-run-v1" || saved.savedAt !== selection.savedAt)
      throw new CompletedReadRefusal("changed");
    // Copy scalar snapshot bytes before another asynchronous reader can replace
    // or mutate an adapter-returned object shared with the second capture.
    return { intent: intentSnapshot, claim: claimSnapshot, startedAt,
      saved: { id: saved.id, format: saved.format, savedAt: saved.savedAt, serializedRun: saved.serializedRun } };
  };
  try {
    const first = await capture();
    const run = checkedRun(first.saved.serializedRun, first.saved.savedAt, selection, wallet);
    if (Date.parse(run.createdAt) < Date.parse(first.startedAt)) throw new Error();
    const observations: Array<{ paperUrl: string; status: "retained" | "unavailable" | "unknown"; reason: string }> = [];
    const admitted: RetainedRow[] = [];
    for (const selected of selection.sources) {
      const rows = (run.evidence ?? []).filter(row => row.itemUrl === selected.itemUrl);
      const candidates = run.citations.filter(row => row.itemUrl === selected.itemUrl);
      if (rows.some(row => !exact(row, selected)) || candidates.some(row => !exact(row, selected))) throw new Error();
      if (rows.some(seed) || candidates.some(seed)) throw new Error();
      if (!rows.length || !candidates.length) {
        observations.push({ paperUrl: selected.itemUrl, status: "unknown", reason: "Exact original read provenance was not retained." }); continue;
      }
      const valid = rows.filter(row => {
        const citation = run.citations.find(value => value.marker === row.marker);
        if (!citation || !exact(citation, row) || seed(citation)) throw new Error();
        const decisions = run.decisions.filter(value => value.sourceId === row.sourceId);
        if (decisions.length !== 1 || decisions[0].action === "SKIP" || !decisions[0].targets.includes(row.claimIndex)) return false;
        for (const field of ["itemId", "itemUrl", "contentVersion"] as const)
          if (decisions[0][field] !== undefined && decisions[0][field] !== row[field]) throw new Error();
        // Explicit answer eligibility is mandatory. A false reward flag is not
        // evidence of a free/public read, and a model support score alone is insufficient.
        return row.qualifiesForAnswer === true && row.support >= MIN_REWARD_SUPPORT
          && extractAnswerMarkers(run.answer).has(row.marker) && retainedBodyBinding(row, citation);
      });
      if (!valid.length) observations.push({ paperUrl: selected.itemUrl, status: "unavailable", reason: "No eligible version-bound retained body excerpt is available." });
      else { admitted.push(...valid); observations.push({ paperUrl: selected.itemUrl, status: "retained", reason: "Authenticated saved ledger; semantic support is unjudged." }); }
    }
    // Re-read the same owner-bound completion before disclosure. Exact bytes,
    // signature-bearing intent and worker claim must still match the first read.
    const second = await capture();
    if (first.intent !== second.intent || first.claim !== second.claim
      || first.saved.serializedRun !== second.saved.serializedRun || first.saved.savedAt !== second.saved.savedAt) throw new Error();
    const markers = new Set(admitted.map(row => row.marker));
    const report = evidenceDraftReportSchema.parse({ id: run.id, subClaims: run.subClaims,
      citations: run.citations.filter(row => markers.has(row.marker)), evidence: admitted });
    const editable: EvidenceDraftRequest = parseEvidenceDraftRequest({ version: 1, scope: "private-evidence-draft", workspace,
      reports: [report], passage: "", claims: [], themes: [],
      readingStatuses: observations.filter(row => row.status === "unavailable").map(row => ({ paperUrl: row.paperUrl, status: "unavailable", reason: row.reason })) });
    if (retainedDraftExcerpts(editable).length !== admitted.length) throw new Error();
    const editableRequest = assembleEvidenceDraftRequest(editable, { mode: "append" });
    return { format: "completed-evidence-draft-v1" as const, wallet, capability: COMPLETED_READ_CAPABILITY,
      baseUrl, network, selection, observations,
      provenance: { origin: "authenticated-owned-saved-ledger" as const, snapshotSha256: selection.snapshotSha256,
        bodyVerification: "recorded-gate-not-reperformed" as const, semanticSupport: "UNJUDGED" as const,
        coverage: null, usefulness: null, unsupportedStatementRate: null, expert: null,
        portableReimport: "caller-supplied-no-authentication" as const, payoutAuthority: false as const },
      editableRequest, draft: buildEvidenceDraft(editableRequest), exports: exportEvidenceDraft(editableRequest) };
  } catch (error) {
    if (error instanceof CompletedReadRefusal) throw error;
    throw new CompletedReadRefusal("changed");
  }
}
export type CompletedEvidenceDraftPacket = Awaited<ReturnType<typeof loadCompletedEvidenceDraft>>;
