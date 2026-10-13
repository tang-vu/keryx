import { checkpointData, numberOperand } from "./actual-read-policy";
import { decimalMicros } from "./exact-units";

/** Frozen diagnostics only. Never imports an agent, payment gateway, DB or server. */
export const ECONOMIC_POLICY = "query-economics-replay-v1" as const;
export const ECONOMIC_LIMIT = 256;
export const ECONOMIC_EVENTS = ["portfolio", "duplicate", "review-withheld", "pre-submission", "sufficient",
  "funding", "pending", "settled-undelivered", "delivered", "initial-remaining", "debit-remaining", "attribution", "authors", "reward-withheld", "admission-withheld", "operating-allocation"] as const;
export type EconomicEvent = typeof ECONOMIC_EVENTS[number];
export type EconomicKind = "query-budget" | "citation-allocation" | "author-split" | "reward-authority";
export type BudgetOperation = "reserve" | "release" | "add" | "remaining" | "hold";
export interface BudgetInput { operation: BudgetOperation; before: string; operands: string[] }
export interface AllocationInput {
  sourceTotal: string; total: string; groups: number[];
  proposals: { group: number; weight: string | null }[]; eligible: boolean[];
}
export interface AuthorInput { total: string; weights: string[] }
export type EconomicPayload =
  | { kind: "query-budget"; event: EconomicEvent; input: BudgetInput; outcome: { beforeMicros: string; afterMicros: string } }
  | { kind: "citation-allocation"; event: "attribution"; input: AllocationInput; outcome: { weights: string[]; grossMicros: string[]; rewardsMicros: string[] } }
  | { kind: "author-split"; event: "authors"; input: AuthorInput; outcome: { legMicros: string[] } };
export type EconomicRefusal = "nonmicro-input" | "invalid-input" | "output-disagreement" | "capture-failed" | "bounds" | "authority-not-captured";
export interface EconomicContext { sequence: number; afterCheckpoint: number; candidate: number; round: number }
export type EconomicRecord = EconomicContext & ({ status: "available" } & EconomicPayload |
  { status: "unavailable"; kind: EconomicKind; event: EconomicEvent; reason: EconomicRefusal });
export type EconomicCapture = { status: "unavailable"; reason: "bounds" | "capture-failed" } |
  { status: "available"; policy: typeof ECONOMIC_POLICY; records: EconomicRecord[] };
export class EconomicUnavailable extends Error {
  constructor(readonly reason: EconomicRefusal) { super("Economic replay unavailable"); }
}
function fail(reason: EconomicRefusal): never { throw new EconomicUnavailable(reason); }
function integer(value: unknown, max = ECONOMIC_LIMIT): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) fail("invalid-input");
  return value as number;
}
function array<T>(value: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("invalid-input");
  const fields = Object.getOwnPropertyDescriptors(value as object), length = integer(fields.length?.value);
  if (Reflect.ownKeys(value).length !== length + 1) fail("invalid-input");
  return Array.from({ length }, (_, i) => {
    if (!fields[i] || !("value" in fields[i])) fail("invalid-input");
    return parse(fields[i].value);
  });
}
function operand(value: unknown): string {
  if (typeof value !== "string" || value.length > 32 || numberOperand(Number(value)) !== value) fail("invalid-input");
  return value;
}
function exact(value: string): string {
  const amount = decimalMicros(Number(value));
  if (amount === null) fail("nonmicro-input");
  return amount;
}
function bool(value: unknown): boolean { if (typeof value !== "boolean") fail("invalid-input"); return value; }
function micro(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) fail("invalid-input");
  return value;
}
function same(value: unknown, expected: unknown) {
  if (JSON.stringify(value) !== JSON.stringify(expected)) fail("output-disagreement");
}

/** Integer arithmetic checks the existing query-local operation, not signer capacity. */
export function replayBudget(input: BudgetInput) {
  const beforeMicros = exact(input.before), before = BigInt(beforeMicros);
  const amounts = input.operands.map(value => BigInt(exact(value)));
  const delta = amounts.reduce((sum, value) => sum + value, BigInt(0));
  if (input.operation === "hold" && amounts.length || input.operation === "reserve" && before !== BigInt(0)) fail("invalid-input");
  let after = input.operation === "release" || input.operation === "remaining" ? before - delta :
    input.operation === "hold" ? before : before + delta;
  if (input.operation === "release" && after < BigInt(0)) after = BigInt(0);
  if (after < BigInt(0) || after > BigInt(Number.MAX_SAFE_INTEGER)) fail("nonmicro-input");
  return { beforeMicros, afterMicros: after.toString() };
}

/** Frozen largest-remainder v1: retains the live Number-weight arithmetic and stable index ties. */
export function replaySplit(total: string, weights: string[]): string[] {
  const amount = exact(total), count = weights.length;
  const totalMicros = Math.round(Number(total) * 1e6);
  if (!Number.isSafeInteger(totalMicros) || String(totalMicros) !== amount) fail("nonmicro-input");
  const clamped = weights.map(value => Number(value) > 0 ? Number(value) : 0);
  const sum = clamped.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum)) fail("invalid-input");
  if (!count) return [];
  if (totalMicros <= 0 || sum <= 0) return weights.map(() => "0");
  const ideal = clamped.map(weight => weight / sum * totalMicros), micros = ideal.map(Math.floor);
  let leftover = totalMicros - micros.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(leftover) || leftover < 0 || leftover > count) fail("invalid-input");
  const ranked = ideal.map((value, i) => ({ i, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; leftover > 0; i++, leftover--) micros[ranked[i % count].i] += 1;
  if (micros.some(value => !Number.isSafeInteger(value) || value < 0)) fail("invalid-input");
  return micros.map(String);
}
/** Model output is an input observation. Only its fixed normalization is replayed. */
export function replayAllocation(input: AllocationInput) {
  exact(input.sourceTotal); exact(input.total);
  if (Number(input.total) !== Math.round(Number(input.sourceTotal) * 1e6) / 1e6 || !input.groups.length ||
      input.groups.length !== input.eligible.length) fail("invalid-input");
  const allowed = new Set(input.groups), byGroup = new Map<number, number>();
  let invalid = false;
  for (const item of input.proposals) {
    const weight = item.weight === null ? NaN : Number(item.weight);
    if (!allowed.has(item.group) || byGroup.has(item.group) || !Number.isFinite(weight) || weight <= 0) { invalid = true; continue; }
    byGroup.set(item.group, weight);
  }
  const total = [...byGroup.values()].reduce((sum, value) => sum + value, 0);
  const normalized = !invalid && byGroup.size === input.groups.length && Number.isFinite(total) && total > 0
    ? input.groups.map(group => byGroup.get(group)! / total) : input.groups.map(() => 1 / input.groups.length);
  const weights = normalized.map(numberOperand), grossMicros = replaySplit(input.total, weights);
  return { weights, grossMicros, rewardsMicros: grossMicros.map((value, i) => input.eligible[i] ? value : "0") };
}

function payload(value: Record<string, unknown>): EconomicPayload {
  const { kind, event } = value;
  if (kind === "query-budget") {
    const row = checkpointData(value.input, ["operation", "before", "operands"]);
    if (!["reserve", "release", "add", "remaining", "hold"].includes(row.operation as string)) fail("invalid-input");
    const operation = row.operation as BudgetOperation;
    const events: Record<BudgetOperation, readonly string[]> = { reserve: ["portfolio"], release: ["duplicate", "review-withheld", "pre-submission", "sufficient"],
      add: ["delivered", "pending", "settled-undelivered"], remaining: ["initial-remaining", "debit-remaining"], hold: ["funding", "pending", "settled-undelivered", "admission-withheld"] };
    if (!events[operation].includes(event as string)) fail("invalid-input");
    const input = { operation, before: operand(row.before), operands: array(row.operands, operand) };
    const outcome = checkpointData(value.outcome, ["beforeMicros", "afterMicros"]), expected = replayBudget(input);
    same({ beforeMicros: micro(outcome.beforeMicros), afterMicros: micro(outcome.afterMicros) }, expected);
    return { kind, event: event as EconomicEvent, input, outcome: expected };
  }
  if (kind === "citation-allocation" && event === "attribution") {
    const row = checkpointData(value.input, ["sourceTotal", "total", "groups", "proposals", "eligible"]);
    const input = { sourceTotal: operand(row.sourceTotal), total: operand(row.total), groups: array(row.groups, value => integer(value, 10000)),
      proposals: array(row.proposals, value => { const entry = checkpointData(value, ["group", "weight"]);
        return { group: integer(entry.group, 10000), weight: entry.weight === null ? null : operand(entry.weight) }; }), eligible: array(row.eligible, bool) };
    if (input.groups.some(group => group === 0)) fail("invalid-input");
    const outcome = checkpointData(value.outcome, ["weights", "grossMicros", "rewardsMicros"]);
    const actual = { weights: array(outcome.weights, operand), grossMicros: array(outcome.grossMicros, micro), rewardsMicros: array(outcome.rewardsMicros, micro) };
    const expected = replayAllocation(input); same(actual, expected); return { kind, event, input, outcome: expected };
  }
  if (kind === "author-split" && event === "authors") {
    const row = checkpointData(value.input, ["total", "weights"]), input = { total: operand(row.total), weights: array(row.weights, operand) };
    const outcome = checkpointData(value.outcome, ["legMicros"]), expected = { legMicros: replaySplit(input.total, input.weights) };
    same({ legMicros: array(outcome.legMicros, micro) }, expected); return { kind, event, input, outcome: expected };
  }
  fail("invalid-input");
}
export function economicRecord(value: unknown, sequence: number, maxCheckpoint: number): EconomicRecord {
  const descriptor = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "status") : undefined;
  const status = descriptor && "value" in descriptor ? descriptor.value : undefined;
  const row = checkpointData(value, ["sequence", "afterCheckpoint", "candidate", "round", "status", "kind", "event",
    ...(status === "available" ? ["input", "outcome"] : ["reason"])]);
  const context = { sequence: integer(row.sequence), afterCheckpoint: integer(row.afterCheckpoint), candidate: integer(row.candidate, 10000), round: integer(row.round, 8) };
  if (context.sequence !== sequence || context.afterCheckpoint > maxCheckpoint || !ECONOMIC_EVENTS.includes(row.event as EconomicEvent)) fail("invalid-input");
  if (status === "available") return { ...context, status, ...payload(row) };
  if (status !== "unavailable" || !["query-budget", "citation-allocation", "author-split", "reward-authority"].includes(row.kind as string) ||
      !["nonmicro-input", "invalid-input", "output-disagreement", "capture-failed", "bounds", "authority-not-captured"].includes(row.reason as string)) fail("invalid-input");
  return { ...context, status, kind: row.kind as EconomicKind, event: row.event as EconomicEvent, reason: row.reason as EconomicRefusal };
}
export function economicCapture(value: unknown, maxCheckpoint: number): EconomicCapture {
  const descriptor = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "status") : undefined;
  if (descriptor && "value" in descriptor && descriptor.value === "unavailable") {
    const row = checkpointData(value, ["status", "reason"]);
    if (row.reason !== "bounds" && row.reason !== "capture-failed") fail("invalid-input");
    return { status: "unavailable", reason: row.reason };
  }
  const row = checkpointData(value, ["status", "policy", "records"]);
  if (row.status !== "available" || row.policy !== ECONOMIC_POLICY) fail("invalid-input");
  let sequence = 0;
  const records = array(row.records, value => economicRecord(value, sequence++, maxCheckpoint));
  if (records.some((record, i) => i > 0 && record.afterCheckpoint < records[i - 1].afterCheckpoint)) fail("invalid-input");
  return { status: "available", policy: ECONOMIC_POLICY, records };
}
/** Describes captured records, never a complete family or payment authority. */
export function economicReplaySummary(capture: EconomicCapture) {
  const family = (kind: EconomicKind) => {
    if (capture.status === "unavailable") return "unavailable" as const;
    const rows = capture.records.filter(record => record.kind === kind);
    if (!rows.length) return "uncaptured" as const;
    if (rows.every(record => record.status === "available")) return "replayable-records" as const;
    return rows.some(record => record.status === "available") ? "partial-records" as const : "unavailable" as const;
  };
  return { queryBudget: family("query-budget"), citationAllocation: family("citation-allocation"), authorSplit: family("author-split"),
    availableRecords: capture.status === "available" ? capture.records.filter(record => record.status === "available").length : 0,
    unavailableRecords: capture.status === "available" ? capture.records.filter(record => record.status === "unavailable").length : null,
    rewardAuthority: "not-replayed" as const, signerCapacity: "not-replayed" as const, settlementAuthority: "unproven" as const };
}
