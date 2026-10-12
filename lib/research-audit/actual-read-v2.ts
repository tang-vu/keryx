import { checkpointData, numberOperand, type PlannedReadAction } from "./actual-read-policy";
import { decimalMicros } from "./exact-units";
import { normalizeClaimTargets, MIN_PREVIEW_EXPECTED_VALUE } from "../agent/coverage-precheck";
import type { ActualReadRecord } from "./actual-read-record";

export const ACTUAL_READ_CAPTURE_V2 = "ordinary-read-capture-v2" as const;
const LIMIT = 256;
export interface MappingInput {
  candidate: number; proposal: PlannedReadAction; matched: boolean; duplicate: boolean; external: boolean;
  public: boolean; claimCount: number; targets: number[];
}
export interface MappingOutcome { action: PlannedReadAction | "DROP"; targets: number[] }
export interface NormalizationInput {
  candidate: number; proposal: PlannedReadAction | "UNKNOWN"; mapped: PlannedReadAction;
  price: string; expectedValue: string; claimCount: number; targets: number[]; allowedTargets: number[];
  freshCache: boolean; originalPage: boolean; discussion: boolean; attentionFloor: string;
}
export interface NormalizationOutcome { action: PlannedReadAction; targets: number[]; priceMicros: string | null; rule: string }
export interface PortfolioObservation {
  policy: "claim-coverage-v1"; replay: "unavailable";
  input: { claimCount: number; attentionLimit: number; fetchBudget: string;
    candidates: { candidate: number; documentGroup: number; action: PlannedReadAction; price: string; expectedValue: string; targets: number[]; public: boolean }[] };
  outcome: { selected: number[]; selectionMethod: "exhaustive" | "bounded-heuristic"; evaluatedStates: number;
    cap: string; reserved: string; capMicros: string | null; reservedMicros: string | null };
}
export interface StopRecord { afterCheckpoint: number; stage: "discovery" | "evidence"; count: number; action: "STOP" }
export interface FinalObservations {
  actions: { candidate: number; action: PlannedReadAction; price: string; priceMicros: string | null }[];
  citations: { candidate: number; reward: string; rewardMicros: string | null }[];
  payments: { candidate: number; kind: "fetch" | "citation" | "inbound" | "operating-fee";
    amount: string; amountMicros: string | null; status: "settled" | "pending" | "failed" | "simulated" | "unknown"; settled: boolean }[];
}
export interface ActualReadPacketV2 {
  schema: 2; policy: typeof ACTUAL_READ_CAPTURE_V2; coverage: "normalization-and-read-checkpoints";
  monetaryAuthority: "qualified-assertions-only"; records: ActualReadRecord[];
  mappings: { input: MappingInput; outcome: MappingOutcome }[];
  normalizations: { input: NormalizationInput; outcome: NormalizationOutcome }[];
  portfolio: PortfolioObservation | null; stops: StopRecord[]; observations: FinalObservations;
}
function integer(value: unknown, max = 10000): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw Error("Invalid capture integer");
}
function bool(value: unknown): asserts value is boolean { if (typeof value !== "boolean") throw Error("Invalid capture flag"); }
function action(value: unknown, unknown = false): asserts value is PlannedReadAction | "UNKNOWN" {
  if (!["BUY", "SKIP", "CACHE", ...(unknown ? ["UNKNOWN"] : [])].includes(value as string)) throw Error("Invalid captured action");
}
function operand(value: unknown): string {
  if (typeof value !== "string" || value.length > 32 || numberOperand(Number(value)) !== value) throw Error("Invalid capture operand");
  return value;
}
function array<T>(value: unknown, parse: (value: unknown) => T, max = LIMIT): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw Error("Invalid capture array");
  const fields = Object.getOwnPropertyDescriptors(value as object), length: unknown = fields.length?.value; integer(length, max);
  if (Reflect.ownKeys(value).length !== length + 1) throw Error("Invalid capture array properties");
  return Array.from({ length }, (_, index) => {
    if (!fields[index] || !("value" in fields[index])) throw Error("Invalid capture array element");
    return parse(fields[index].value);
  });
}
function indices(value: unknown) { return array(value, value => { integer(value); return value; }, 10000); }
function exact(value: unknown, original: string): string | null {
  const expected = decimalMicros(Number(original));
  if (value !== expected) throw Error("Capture amount disagreement");
  return expected;
}
export function replayMapping(input: MappingInput): MappingOutcome {
  const action = input.external ? "SKIP" : !input.matched || input.duplicate ? "DROP" :
    input.public && input.proposal !== "SKIP" ? "CACHE" : input.proposal;
  return { action, targets: action === "DROP" || input.external ? [] : normalizeClaimTargets(input.targets, input.claimCount) };
}
export function replayNormalization(input: NormalizationInput): NormalizationOutcome {
  let action = input.mapped, rule = "unchanged";
  if (input.discussion) { action = "SKIP"; rule = "discussion"; }
  else {
    if (action === "CACHE" && !input.freshCache && !input.originalPage) { action = "BUY"; rule = "cache-expired"; }
    if ((action === "BUY" || action === "CACHE") &&
      (!normalizeClaimTargets(input.allowedTargets, input.claimCount).length || Number(input.expectedValue) < MIN_PREVIEW_EXPECTED_VALUE)) {
      action = "SKIP"; rule = "preview";
    } else if (action === "CACHE" && (!input.allowedTargets.length || Number(input.expectedValue) < Number(input.attentionFloor))) {
      action = "SKIP"; rule = "attention";
    }
  }
  return { action, targets: [...input.allowedTargets], priceMicros: decimalMicros(Number(input.price)), rule };
}
function mapping(value: unknown) {
  const row = checkpointData(value, ["input", "outcome"]), fields = checkpointData(row.input,
    ["candidate", "proposal", "matched", "duplicate", "external", "public", "claimCount", "targets"]);
  integer(fields.candidate); integer(fields.claimCount); action(fields.proposal);
  for (const field of ["matched", "duplicate", "external", "public"]) bool(fields[field]);
  const input = { ...fields, targets: indices(fields.targets) } as unknown as MappingInput;
  const outcome = checkpointData(row.outcome, ["action", "targets"]), expected = replayMapping(input);
  if (outcome.action !== expected.action || JSON.stringify(indices(outcome.targets)) !== JSON.stringify(expected.targets)) throw Error("Mapping disagreement");
  return { input, outcome: expected };
}
function normalization(value: unknown) {
  const row = checkpointData(value, ["input", "outcome"]), fields = checkpointData(row.input,
    ["candidate", "proposal", "mapped", "price", "expectedValue", "claimCount", "targets", "allowedTargets", "freshCache", "originalPage", "discussion", "attentionFloor"]);
  integer(fields.candidate); integer(fields.claimCount); action(fields.proposal, true); action(fields.mapped);
  for (const name of ["freshCache", "originalPage", "discussion"]) bool(fields[name]);
  for (const name of ["price", "expectedValue", "attentionFloor"]) operand(fields[name]);
  if (Number(fields.expectedValue) < 0 || Number(fields.expectedValue) > 1 || Number(fields.attentionFloor) < 0 || Number(fields.attentionFloor) > 1) throw Error("Invalid captured relevance");
  const targets = indices(fields.targets), allowedTargets = indices(fields.allowedTargets);
  if (allowedTargets.some(target => !targets.includes(target))) throw Error("Invalid target observation");
  const input = { ...fields, targets, allowedTargets } as unknown as NormalizationInput;
  const outcome = checkpointData(row.outcome, ["action", "targets", "priceMicros", "rule"]), expected = replayNormalization(input);
  if (outcome.action !== expected.action || outcome.rule !== expected.rule || outcome.priceMicros !== expected.priceMicros ||
    JSON.stringify(indices(outcome.targets)) !== JSON.stringify(expected.targets)) throw Error("Normalization disagreement");
  return { input, outcome: expected };
}
function portfolio(value: unknown): PortfolioObservation | null {
  if (value === null) return null;
  const row = checkpointData(value, ["policy", "replay", "input", "outcome"]);
  if (row.policy !== "claim-coverage-v1" || row.replay !== "unavailable") throw Error("Unsupported optimizer replay claim");
  const input = checkpointData(row.input, ["claimCount", "attentionLimit", "fetchBudget", "candidates"]);
  integer(input.claimCount); integer(input.attentionLimit, 32); operand(input.fetchBudget);
  const candidates = array(input.candidates, value => {
    const item = checkpointData(value, ["candidate", "documentGroup", "action", "price", "expectedValue", "targets", "public"]);
    integer(item.candidate); integer(item.documentGroup); action(item.action); operand(item.price); operand(item.expectedValue); bool(item.public);
    return { ...item, targets: indices(item.targets) } as unknown as PortfolioObservation["input"]["candidates"][number];
  });
  const outcome = checkpointData(row.outcome, ["selected", "selectionMethod", "evaluatedStates", "cap", "reserved", "capMicros", "reservedMicros"]);
  const selected = indices(outcome.selected); integer(outcome.evaluatedStates, 20000); operand(outcome.cap); operand(outcome.reserved);
  if (!["exhaustive", "bounded-heuristic"].includes(outcome.selectionMethod as string) || new Set(selected).size !== selected.length ||
    selected.some(candidate => !candidates.some(item => item.candidate === candidate && item.action !== "SKIP"))) throw Error("Invalid optimizer observation");
  exact(outcome.capMicros, outcome.cap as string); exact(outcome.reservedMicros, outcome.reserved as string);
  return { policy: "claim-coverage-v1", replay: "unavailable", input: { ...input, candidates }, outcome: { ...outcome, selected } } as unknown as PortfolioObservation;
}
function observations(value: unknown): FinalObservations {
  const row = checkpointData(value, ["actions", "citations", "payments"]);
  const actions = array(row.actions, value => { const item = checkpointData(value, ["candidate", "action", "price", "priceMicros"]);
    integer(item.candidate); action(item.action); operand(item.price); exact(item.priceMicros, item.price as string); return item as unknown as FinalObservations["actions"][number]; });
  const citations = array(row.citations, value => { const item = checkpointData(value, ["candidate", "reward", "rewardMicros"]);
    integer(item.candidate); operand(item.reward); exact(item.rewardMicros, item.reward as string); return item as unknown as FinalObservations["citations"][number]; });
  const payments = array(row.payments, value => { const item = checkpointData(value, ["candidate", "kind", "amount", "amountMicros", "status", "settled"]);
    integer(item.candidate); operand(item.amount); exact(item.amountMicros, item.amount as string); bool(item.settled);
    if (!["fetch", "citation", "inbound", "operating-fee"].includes(item.kind as string) || !["settled", "pending", "failed", "simulated", "unknown"].includes(item.status as string)) throw Error("Invalid recorded payment state");
    return item as unknown as FinalObservations["payments"][number]; });
  return { actions, citations, payments };
}
/** Closed public capture. Source/optimizer/settlement facts remain assertions, not replayed authority. */
export function canonicalReadPacketV2(value: unknown, legacyRecords: (records: unknown) => ActualReadRecord[]): string {
  const packet = checkpointData(value, ["schema", "policy", "coverage", "monetaryAuthority", "records", "mappings", "normalizations", "portfolio", "stops", "observations"]);
  if (packet.schema !== 2 || packet.policy !== ACTUAL_READ_CAPTURE_V2 || packet.coverage !== "normalization-and-read-checkpoints" || packet.monetaryAuthority !== "qualified-assertions-only") throw Error("Unsupported capture policy");
  const records = array(packet.records, value => value).length ? legacyRecords(packet.records) : [];
  const stops = array(packet.stops, value => { const row = checkpointData(value, ["afterCheckpoint", "stage", "count", "action"]);
    integer(row.afterCheckpoint, records.length); integer(row.count);
    if (!["discovery", "evidence"].includes(row.stage as string) || row.count !== 0 || row.action !== "STOP") throw Error("Stop replay disagreement");
    return row as unknown as StopRecord; });
  if (!records.length && !stops.length) throw Error("Empty capture");
  const canonical = JSON.stringify({ schema: 2, policy: ACTUAL_READ_CAPTURE_V2, coverage: "normalization-and-read-checkpoints", monetaryAuthority: "qualified-assertions-only",
    records, mappings: array(packet.mappings, mapping), normalizations: array(packet.normalizations, normalization), portfolio: portfolio(packet.portfolio), stops, observations: observations(packet.observations) });
  if (new TextEncoder().encode(canonical).byteLength > 256 * 1024) throw Error("Oversized capture");
  return canonical;
}
