import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

/** Reviewed public tariff facts, not invoices or permission to renew a closed allowance. */
export const RESEARCH_ALLOWANCE_REVIEW = {
  policyId: "keryx-live-browser-2026-10-05-v2",
  priceCheckedOn: "2026-10-05",
  modelPricePolicyId: "deepseek-flash-reviewed-2026-10-05-v1",
  modelEvidenceSha256: "210f102275ccf1a6542f08a3bc9e4b4c7c83278cb74b35217bffa112df6363b2",
  searchPricePolicyId: "tavily-basic-reviewed-2026-10-05-v1",
  searchEvidenceSha256: "3b21fe9c9c0ba44a0662551d9d247f98277a9cc70d242a8ada91309dba829b83",
  modelReserveMicroUsd: 20660,
  modelPeakInputUsdPerMillion: 0.30,
  modelPeakOutputUsdPerMillion: 1.20,
  framingTokens: 4096,
  searchReserveMicroUsd: 8000,
  searchCreditsPerRequest: 1,
  searchPaygUsdPerCredit: 0.008,
} as const;

const questionHash = z.string().regex(/^[a-f0-9]{64}$/);
const policySchema = z.object({
  format: z.literal("keryx-production-research-allowance-v2"),
  policyId: z.literal(RESEARCH_ALLOWANCE_REVIEW.policyId),
  priceCheckedOn: z.literal(RESEARCH_ALLOWANCE_REVIEW.priceCheckedOn),
  pricePolicyId: z.literal(RESEARCH_ALLOWANCE_REVIEW.modelPricePolicyId),
  modelEvidenceSha256: z.literal(RESEARCH_ALLOWANCE_REVIEW.modelEvidenceSha256),
  provider: z.literal("deepseek"),
  endpoint: z.literal("https://api.deepseek.com/chat/completions"),
  model: z.literal("deepseek-v4-flash"),
  expiresAt: z.string().datetime(),
  maximumMicroUsd: z.literal(1000000),
  maximumCalls: z.literal(46),
  maximumInputBytes: z.literal(32000),
  maximumOutputTokens: z.literal(8192),
  journalDirectory: z.string().min(1).max(4096),
  search: z.object({
    provider: z.literal("tavily"),
    endpoint: z.literal("https://api.tavily.com/search"),
    pricePolicyId: z.literal(RESEARCH_ALLOWANCE_REVIEW.searchPricePolicyId),
    evidenceSha256: z.literal(RESEARCH_ALLOWANCE_REVIEW.searchEvidenceSha256),
    searchDepth: z.literal("basic"),
    maximumCalls: z.literal(6),
    reservePerCallMicroUsd: z.literal(RESEARCH_ALLOWANCE_REVIEW.searchReserveMicroUsd),
  }).strict(),
  research: z.object({
    origin: z.literal("web"),
    mode: z.literal("quick"),
    sourceBudgetMicroUsdc: z.literal(0),
    maximumQuestions: z.literal(3),
    maximumSearchCallsPerQuestion: z.literal(2),
    questionSha256: z.array(questionHash).length(3).refine(values => new Set(values).size === 3),
  }).strict(),
}).strict();

export type ResearchAllowancePolicy = z.infer<typeof policySchema>;
export interface ConfiguredResearchAllowance { policy: ResearchAllowancePolicy; digest: string; file: string }
export interface BoundedResearchInput {
  question: string;
  queryId: string;
  origin?: string;
  researchMode?: string;
  budget?: number;
  fundingOwner?: string;
  privateScope?: boolean;
  paidScholarly?: boolean;
}
/** Receipt identifiers are public; possession of a lookalike object grants no admission. */
export interface BoundedResearchAdmission {
  readonly policySha256: string;
  readonly questionSha256: string;
  readonly queryIdSha256: string;
}
interface AdmissionState {
  allowance: ResearchAllowance;
  receipt: string;
  open: boolean;
  signal?: AbortSignal;
}
const admitted = new WeakMap<BoundedResearchAdmission, AdmissionState>();
const context = new AsyncLocalStorage<BoundedResearchAdmission>();
function refuse(reason: string): never { throw new Error(`Bounded research allowance ${reason}`); }
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? error.code : undefined;

function protectedPath(file: string, directory: boolean) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file) refuse("requires an absolute protected path");
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1))
    refuse("storage type refused");
  if (fs.realpathSync(file) !== file) refuse("storage symlink refused");
  if (process.platform !== "win32" && (stat.uid !== process.getuid!() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)))
    refuse("storage permissions refused");
  return stat;
}

function readProtected(file: string) {
  const before = protectedPath(file, false);
  if (before.size > 16384) refuse("retained file too large");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino) refuse("retained file changed during read");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size)
      refuse("retained file changed during read");
    return bytes;
  } finally { fs.closeSync(fd); }
}

function syncDirectory(directory: string) {
  // No environment switch permits weaker durability. Windows unit fixtures inject this single
  // operation; the normal production constructor requires actual POSIX directory fsync.
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function validateResearchAllowancePolicy(value: unknown, now = new Date()) {
  let policy: ResearchAllowancePolicy;
  try { policy = policySchema.parse(value); } catch { return refuse("policy refused"); }
  if (now.toISOString().slice(0, 10) !== policy.priceCheckedOn ||
      Date.parse(policy.expiresAt) <= now.getTime() || policy.expiresAt.slice(0, 10) !== policy.priceCheckedOn)
    refuse("expired; a new tariff review and authorization are required");
  // 46 * 20660 + 6 * 8000 = 998360 microUSD; failed/unknown calls retain the full hold.
  if (Math.ceil((policy.maximumInputBytes + RESEARCH_ALLOWANCE_REVIEW.framingTokens) *
      RESEARCH_ALLOWANCE_REVIEW.modelPeakInputUsdPerMillion + policy.maximumOutputTokens *
      RESEARCH_ALLOWANCE_REVIEW.modelPeakOutputUsdPerMillion) !== RESEARCH_ALLOWANCE_REVIEW.modelReserveMicroUsd)
    refuse("reviewed model ceiling mismatch");
  if (policy.maximumCalls * RESEARCH_ALLOWANCE_REVIEW.modelReserveMicroUsd +
      policy.search.maximumCalls * RESEARCH_ALLOWANCE_REVIEW.searchReserveMicroUsd > policy.maximumMicroUsd)
    refuse("combined ceiling exceeded");
  protectedPath(policy.journalDirectory, true);
  return policy;
}

export function configuredResearchAllowance(): ConfiguredResearchAllowance | null {
  const file = process.env.KERYX_MODEL_ALLOWANCE_FILE;
  const digest = process.env.KERYX_MODEL_ALLOWANCE_SHA256;
  if (file === undefined && digest === undefined) return null;
  if (!file || !digest || !/^[a-f0-9]{64}$/.test(digest)) return refuse("configuration refused");
  const bytes = readProtected(file);
  if (sha(bytes) !== digest) return refuse("policy digest mismatch");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return refuse("policy refused"); }
  if (value && typeof value === "object" && "format" in value && value.format === "keryx-production-model-allowance-v1") {
    // Preserve the historical model-only format, but it cannot reopen on the new review date.
    if (new Date().toISOString().slice(0, 10) !== "2026-10-04" ||
        !("expiresAt" in value) || typeof value.expiresAt !== "string" ||
        !(Date.parse(value.expiresAt) > Date.now()) || value.expiresAt.slice(0, 10) !== "2026-10-04")
      refuse("historical model-only allowance is closed");
    return null;
  }
  return { policy: validateResearchAllowancePolicy(value), digest, file };
}

export class ResearchAllowance {
  constructor(readonly configured: ConfiguredResearchAllowance,
    private readonly flushDirectory: (directory: string) => void = syncDirectory) {
    validateResearchAllowancePolicy(configured.policy);
    const manifest = path.join(configured.policy.journalDirectory, "policy.sha256");
    this.createRetainedFile(manifest, `${configured.digest}\n`, true);
    this.validateRetainedPolicy();
  }

  private createRetainedFile(file: string, content: string, allowExisting = false) {
    let fd: number;
    try { fd = fs.openSync(file, "wx", 0o600); }
    catch (error) { if (allowExisting && errorCode(error) === "EEXIST") return false; throw error; }
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    this.flushDirectory(this.configured.policy.journalDirectory);
    return true;
  }

  private validateRetainedPolicy() {
    const { policy, digest, file } = this.configured;
    const snapshot = validateResearchAllowancePolicy(policy);
    const bytes = readProtected(file);
    if (process.env.KERYX_MODEL_ALLOWANCE_FILE !== file || process.env.KERYX_MODEL_ALLOWANCE_SHA256 !== digest ||
        sha(bytes) !== digest) refuse("policy changed; retained holds preserved");
    let retained: unknown;
    try { retained = JSON.parse(bytes.toString("utf8")); } catch { return refuse("policy refused"); }
    if (JSON.stringify(validateResearchAllowancePolicy(retained)) !== JSON.stringify(snapshot))
      refuse("policy snapshot mismatch; retained holds preserved");
    if (readProtected(path.join(policy.journalDirectory, "policy.sha256")).toString("utf8") !== `${digest}\n`)
      refuse("journal belongs to a different policy");
    for (const name of fs.readdirSync(policy.journalDirectory)) {
      if (name === "policy.sha256") continue;
      const model = /^model-([0-9]{4})\.json$/.exec(name);
      const question = /^question-([a-f0-9]{64})\.json$/.exec(name);
      const search = /^search-([a-f0-9]{64})-(01|02)\.json$/.exec(name);
      if (!(model && Number(model[1]) >= 1 && Number(model[1]) <= policy.maximumCalls) &&
          !(question && policy.research.questionSha256.includes(question[1])) &&
          !(search && policy.research.questionSha256.includes(search[1]))) refuse("unexpected journal state");
      // Empty/partial recognized holds consume capacity; their payload never restores it.
      protectedPath(path.join(policy.journalDirectory, name), false);
    }
  }

  admit(input: BoundedResearchInput): BoundedResearchAdmission {
    this.validateRetainedPolicy();
    if (input.origin !== "web" || input.researchMode !== "quick" || input.budget !== 0 ||
        input.fundingOwner !== "treasury" || input.privateScope !== false || input.paidScholarly === true ||
        typeof input.question !== "string" || typeof input.queryId !== "string" || !input.queryId.trim() || input.queryId.length > 200)
      refuse("requires public web quick research with zero source budget and no browser funding");
    const questionSha256 = sha(input.question);
    if (!this.configured.policy.research.questionSha256.includes(questionSha256)) refuse("question is outside the frozen scope");
    const admission = Object.freeze({ policySha256: this.configured.digest, questionSha256, queryIdSha256: sha(input.queryId) });
    const receipt = JSON.stringify({ format: "keryx-research-question-hold-v2", ...admission,
      reservedAt: new Date().toISOString(), sourceBudgetMicroUsdc: 0, outcome: "consumed-regardless-of-research-outcome" }) + "\n";
    if (!this.createRetainedFile(path.join(this.configured.policy.journalDirectory, `question-${questionSha256}.json`), receipt, true))
      refuse("question already consumed; failed and unknown runs cannot be retried");
    this.validateRetainedPolicy();
    admitted.set(admission, { allowance: this, receipt, open: true });
    return admission;
  }

  private validateAdmission() {
    this.validateRetainedPolicy();
    const admission = context.getStore();
    const state = admission && admitted.get(admission);
    if (state?.signal?.aborted) state.open = false;
    if (!admission || !state?.open || admission.policySha256 !== this.configured.digest ||
        state.allowance.configured.file !== this.configured.file) refuse("requires a current admitted question");
    const file = path.join(this.configured.policy.journalDirectory, `question-${admission.questionSha256}.json`);
    if (readProtected(file).toString("utf8") !== state.receipt) refuse("question receipt changed; retained holds preserved");
    return admission;
  }

  reserveModel(system: string, user: string, maxTokens: number) {
    const admission = this.validateAdmission();
    const inputBytes = Buffer.byteLength(system + " Respond with a single JSON object." + user, "utf8");
    if (inputBytes > this.configured.policy.maximumInputBytes || !Number.isInteger(maxTokens) ||
        maxTokens < 1 || maxTokens > this.configured.policy.maximumOutputTokens) refuse("request bound exceeded; no truncation or fallback");
    return this.reserveSlots(admission, "model", this.configured.policy.maximumCalls,
      RESEARCH_ALLOWANCE_REVIEW.modelReserveMicroUsd, { inputBytes, maximumOutputTokens: maxTokens });
  }

  reserveSearch(query: string) {
    const admission = this.validateAdmission();
    if (typeof query !== "string" || !query.trim() || query.length > 500) refuse("search query bound exceeded");
    return this.reserveSlots(admission, "search", this.configured.policy.research.maximumSearchCallsPerQuestion,
      RESEARCH_ALLOWANCE_REVIEW.searchReserveMicroUsd, { querySha256: sha(query), searchDepth: "basic" });
  }

  private reserveSlots(admission: BoundedResearchAdmission, kind: "model" | "search", slots: number,
    reserveMicroUsd: number, detail: Record<string, string | number>) {
    for (let slot = 1; slot <= slots; slot++) {
      const name = kind === "model" ? `model-${String(slot).padStart(4, "0")}.json`
        : `search-${admission.questionSha256}-${String(slot).padStart(2, "0")}.json`;
      if (this.createRetainedFile(path.join(this.configured.policy.journalDirectory, name),
        JSON.stringify({ format: "keryx-research-request-hold-v2", ...admission, kind, slot,
          reservedAt: new Date().toISOString(), reserveMicroUsd, ...detail, outcome: "held-regardless-of-provider-outcome" }) + "\n", true)) {
        // An expiry/receipt/configuration change during persistence consumes this hold but cannot dispatch.
        this.validateAdmission();
        return { slot, reserveMicroUsd };
      }
    }
    return refuse(`${kind} exhausted; failed and unknown requests still consume capacity`);
  }
}

export function admitBoundedResearch(input: BoundedResearchInput): BoundedResearchAdmission | null {
  const configured = configuredResearchAllowance();
  return configured ? new ResearchAllowance(configured).admit(input) : null;
}

/** Each generator resume carries its own context, including concurrent await descendants. The
 * opaque local token is revoked at completion/cancellation; late work cannot acquire new holds. */
export function bindBoundedResearchAdmission<T, R>(admission: BoundedResearchAdmission,
  generator: AsyncGenerator<T, R, void>, signal?: AbortSignal): AsyncGenerator<T, R, void> {
  const state = admitted.get(admission);
  if (!state?.open) refuse("invalid question admission");
  state.signal = signal;
  const close = () => { state.open = false; signal?.removeEventListener("abort", close); };
  signal?.addEventListener("abort", close, { once: true });
  if (signal?.aborted) close();
  const resume = async (action: () => Promise<IteratorResult<T, R>>, cleanup = false) => {
    if (!state.open && !cleanup) refuse("question admission is closed");
    try {
      const result = await context.run(admission, action);
      if (result.done) close();
      return result;
    } catch (error) { close(); throw error; }
  };
  return {
    next: (...args) => resume(() => generator.next(...args)),
    return: value => { close(); return resume(() => generator.return(value), true); },
    throw: error => { close(); return resume(() => generator.throw(error), true); },
    [Symbol.asyncIterator]() { return this; },
    async [Symbol.asyncDispose]() { close(); await resume(() => generator.return(undefined as R), true); },
  };
}

/** Called by the fixed basic Tavily transport immediately before HTTP, even for other callers. */
export function reserveBoundedSearch(query: string) {
  const configured = configuredResearchAllowance();
  const admission = context.getStore();
  if (!configured) {
    if (admission) refuse("configuration removed during admitted research");
    return null;
  }
  const state = admission && admitted.get(admission);
  if (!state || state.allowance.configured.digest !== configured.digest || state.allowance.configured.file !== configured.file)
    refuse("requires a current admitted question");
  return state.allowance.reserveSearch(query);
}
