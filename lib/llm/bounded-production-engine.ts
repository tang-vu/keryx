import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { FLASH_POLICY } from "../economics/provider-cost-policy";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import type { ChatJsonOptions } from "./json-chat-engine";
import { ReasoningInputLimitError, ReasoningOutputValidationError, ReasoningTransportError, outputTokenLimitFromValidatedError } from "./reasoning-engine";
import { ResearchAllowance, RESEARCH_ALLOWANCE_REVIEW, validateResearchAllowancePolicy,
  type ConfiguredResearchAllowance } from "../research/research-allowance";

// A new date requires a fresh supplier-price review, never just a renewed environment value.
const PRICE_CHECKED_ON = "2026-10-04";
const FRAMING_TOKENS = 4096;
const JSON_INSTRUCTION = " Respond with a single JSON object.";
const policySchema = z.object({
  format: z.literal("keryx-production-model-allowance-v1"),
  priceCheckedOn: z.literal(PRICE_CHECKED_ON),
  pricePolicyId: z.literal(FLASH_POLICY.id),
  provider: z.literal("deepseek"),
  endpoint: z.literal("https://api.deepseek.com/chat/completions"),
  model: z.literal("deepseek-v4-flash"),
  expiresAt: z.string().datetime(),
  maximumMicroUsd: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maximumCalls: z.number().int().positive().max(1000),
  maximumInputBytes: z.number().int().positive().max(32000),
  maximumOutputTokens: z.number().int().positive().max(8192),
  journalDirectory: z.string().min(1).max(4096),
}).strict();
export type ProductionModelAllowancePolicy = z.infer<typeof policySchema>;

const refuse = (reason: string): never => { throw new Error(`Bounded model allowance ${reason}`); };
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const code = (error: unknown) => error && typeof error === "object" && "code" in error ? error.code : undefined;

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
  if (before.size > 16384) refuse("policy too large");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino) refuse("policy changed during read");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size)
      refuse("policy changed during read");
    return bytes;
  } finally { fs.closeSync(fd); }
}

function syncDirectory(directory: string) {
  // The deployed durable mode requires POSIX directory fsync. Tests inject only this operation
  // on Windows; production has no environment switch to weaken the durability requirement.
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function validatePolicy(value: unknown, now = new Date()) {
  let policy: ProductionModelAllowancePolicy;
  try { policy = policySchema.parse(value); } catch { return refuse("policy refused"); }
  if (now.toISOString().slice(0, 10) !== policy.priceCheckedOn ||
      Date.parse(policy.expiresAt) <= now.getTime() || policy.expiresAt.slice(0, 10) !== policy.priceCheckedOn)
    refuse("expired; review prices and retained reservations before a new allowance");
  protectedPath(policy.journalDirectory, true);
  return policy;
}

/** Opt-in is fail-closed: partial, malformed, changed or expired configuration never uses the
 * ordinary provider chain. This function reads no credentials and makes no supplier request. */
export function configuredProductionModelAllowance() {
  const file = process.env.KERYX_MODEL_ALLOWANCE_FILE;
  const expected = process.env.KERYX_MODEL_ALLOWANCE_SHA256;
  if (file === undefined && expected === undefined) return null;
  if (!file || !expected || !/^[a-f0-9]{64}$/.test(expected)) return refuse("configuration refused");
  const bytes = readProtected(file);
  if (hash(bytes) !== expected) return refuse("policy digest mismatch");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return refuse("policy refused"); }
  const policy = value && typeof value === "object" && "format" in value && value.format === "keryx-production-research-allowance-v2"
    ? validateResearchAllowancePolicy(value) : validatePolicy(value);
  return { policy, digest: expected, file };
}

export type ConfiguredProductionModelAllowance = NonNullable<ReturnType<typeof configuredProductionModelAllowance>>;

/** Fixed-cost immutable slots are the atomic reservation. Exclusive creation across workers
 * needs no process-lifetime lock. Empty/interrupted slots consume the full hold forever; success,
 * failure, missing usage and process restart never refund them. The private directory must be
 * preserved with its exact policy across deployment; changing/removing it is a new allowance. */
export class ProductionModelAllowance {
  readonly reservePerCallMicroUsd: number;
  readonly slots: number;
  private readonly research: ResearchAllowance | null;

  constructor(private readonly configured: ConfiguredProductionModelAllowance,
    private readonly flushDirectory: (directory: string) => void = syncDirectory) {
    const { policy } = configured;
    if (policy.format === "keryx-production-research-allowance-v2") {
      this.research = new ResearchAllowance(configured as ConfiguredResearchAllowance, flushDirectory);
      this.reservePerCallMicroUsd = RESEARCH_ALLOWANCE_REVIEW.modelReserveMicroUsd;
      this.slots = policy.maximumCalls;
      return;
    }
    this.research = null;
    validatePolicy(policy);
    this.reservePerCallMicroUsd = Math.ceil(
      (policy.maximumInputBytes + FRAMING_TOKENS) * FLASH_POLICY.upperRates.inputUsdPerMillion +
      policy.maximumOutputTokens * FLASH_POLICY.upperRates.outputUsdPerMillion);
    this.slots = Math.min(policy.maximumCalls, Math.floor(policy.maximumMicroUsd / this.reservePerCallMicroUsd));
    if (this.slots < 1) refuse("cannot reserve one bounded request");
    const manifest = path.join(policy.journalDirectory, "policy.sha256");
    this.createRetainedFile(manifest, `${configured.digest}\n`, true);
    if (readProtected(manifest).toString("utf8") !== `${configured.digest}\n`) refuse("journal belongs to a different policy");
  }

  private createRetainedFile(file: string, content: string, allowExisting = false) {
    let fd: number;
    try { fd = fs.openSync(file, "wx", 0o600); }
    catch (error) { if (allowExisting && code(error) === "EEXIST") return false; throw error; }
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    this.flushDirectory(this.configured.policy.journalDirectory);
    return true;
  }

  reserve(system: string, user: string, maxTokens: number) {
    if (this.research) return this.research.reserveModel(system, user, maxTokens);
    const { policy, digest, file } = this.configured;
    validatePolicy(policy);
    if (hash(readProtected(file)) !== digest) refuse("policy changed; retained holds preserved");
    if (readProtected(path.join(policy.journalDirectory, "policy.sha256")).toString("utf8") !== `${digest}\n`)
      refuse("journal policy changed");
    const bytes = Buffer.byteLength(system + JSON_INSTRUCTION + user, "utf8");
    if (bytes > policy.maximumInputBytes || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > policy.maximumOutputTokens)
      refuse("request bound exceeded; no prompt truncation or provider fallback");
    // Unexpected state must not be silently ignored. A partial numbered reservation is valid
    // consumed capacity, but another file/policy may indicate an operator recovery in progress.
    for (const name of fs.readdirSync(policy.journalDirectory)) {
      if (name === "policy.sha256") continue;
      const match = /^reservation-([0-9]{4})\.json$/.exec(name);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > this.slots) refuse("unexpected journal state");
      protectedPath(path.join(policy.journalDirectory, name), false);
    }
    for (let slot = 1; slot <= this.slots; slot++) {
      const reservation = path.join(policy.journalDirectory, `reservation-${String(slot).padStart(4, "0")}.json`);
      if (this.createRetainedFile(reservation, JSON.stringify({ policySha256: digest, slot,
        reservedAt: new Date().toISOString(), reserveMicroUsd: this.reservePerCallMicroUsd,
        inputBytes: bytes, maximumOutputTokens: maxTokens, outcome: "held-regardless-of-provider-outcome" }) + "\n", true)) {
        // Disk admission can cross the expiry boundary. Keep that slot held but refuse dispatch.
        validatePolicy(policy);
        return { slot, reserveMicroUsd: this.reservePerCallMicroUsd };
      }
    }
    return refuse("exhausted; retained failed and unknown requests still consume capacity");
  }
}

/** Real official transport, bounded before every actual HTTP call, including synthesis review.
 * No provider retry/fallback. The original source/payment behavior is untouched. */
export class BoundedProductionEngine extends OpenAICompatibleEngine {
  constructor(apiKey: string, private readonly allowance: ProductionModelAllowance) {
    if (!apiKey.trim()) refuse("requires the explicit DeepSeek credential");
    super({ provider: "deepseek", name: "llm:deepseek:deepseek-v4-flash", model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com", apiKey, redirect: "error" });
  }

  protected async chatJson(model: string, system: string, user: string, maxTokens = 2048, options?: ChatJsonOptions) {
    this.allowance.reserve(system, user, maxTokens);
    try { return await super.chatJson(model, system, user, maxTokens, options); }
    catch (error) { throw boundedFailure(error); }
  }
}

/** A supplier error body can echo request context, so the original message never leaves this
 * wrapper. Its bounded category does: planning and selection turn invalid output into their own
 * request-local refusals, and a timeout must stay distinguishable from a rejected reply. */
function boundedFailure(error: unknown): Error {
  if (error instanceof ReasoningInputLimitError) return error;
  const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
  const retained = `${status ? ` (${status})` : ""}; reservation retained`;
  if (error instanceof ReasoningOutputValidationError)
    return Object.assign(new ReasoningOutputValidationError(`Bounded model output failed validation${retained}`, outputTokenLimitFromValidatedError(error)), { status });
  if (error instanceof ReasoningTransportError) {
    const failure = new ReasoningTransportError(error.category);
    failure.message = `Bounded model provider request failed (${error.category}); reservation retained`;
    return failure;
  }
  return Object.assign(new Error(`Bounded model provider request failed${retained}`), { status });
}
