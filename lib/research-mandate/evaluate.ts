import { z } from "zod";
import { encodeAbiParameters, encodeFunctionData, getAddress, isAddress, keccak256, stringToBytes, type Hex } from "viem";
import { canonicalJson } from "../canonical-json";
import { purchaseComponents, researchMandateAbi } from "./contract";
import { MAX_MANDATE_BYTES } from "./limits";

const MAX_UNITS = BigInt(1_000_000_000_000_000);
export function microUsdc(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,6})?$/.test(value)) throw new Error("Use an exact nonnegative USDC amount with at most six decimals");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  if (units > MAX_UNITS) throw new Error("USDC amount exceeds the planning limit");
  return units;
}
export function decimalUsdc(value: bigint): string {
  return `${value / BigInt(1_000_000)}.${(value % BigInt(1_000_000)).toString().padStart(6, "0")}`;
}
const amount = z.string().max(17).refine(value => { try { microUsdc(value); return true; } catch { return false; } }, "Invalid exact USDC amount");
const digest = z.string().regex(/^0x[0-9a-fA-F]{64}$/).refine(value => !/^0x0{64}$/.test(value));
const identifier = z.string().min(1).max(128).refine(value => value.trim() === value, "Identifiers cannot contain outer whitespace");
const instant = z.string().max(40).datetime({ offset: true });
const address = z.string().refine(value => isAddress(value) && !/^0x0{40}$/i.test(value));
const unique = <T>(rows: readonly T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length;

export const mandateInputSchema = z.object({
  schema: z.literal("urn:keryx:research-mandate:1"),
  network: z.enum(["eip155:5042", "eip155:5042002"]),
  policy: z.object({
    perPaymentUsdc: amount, dailyUsdc: amount, rollingWeekUsdc: amount, lifetimeUsdc: amount,
    reserveFloorUsdc: amount, expiresAt: instant,
    payees: z.array(address).min(1).max(32).refine(rows => unique(rows, row => row.toLowerCase()), "Duplicate payee"),
    sources: z.array(z.object({ sourceId: digest, payee: address }).strict()).min(1).max(64)
      .refine(rows => unique(rows, row => row.sourceId.toLowerCase()), "Duplicate source"),
    categories: z.array(z.object({ id: identifier, capUsdc: amount }).strict()).min(1).max(16)
      .refine(rows => unique(rows, row => row.id), "Duplicate category"),
    tasks: z.array(z.object({ taskHash: digest, capUsdc: amount }).strict()).min(1).max(64)
      .refine(rows => unique(rows, row => row.taskHash.toLowerCase()), "Duplicate task"),
    liabilities: z.array(z.object({ id: identifier, amountUsdc: amount, dueAt: instant,
      state: z.enum(["open", "unknown", "settled"]) }).strict()).max(128)
      .refine(rows => unique(rows, row => row.id), "Duplicate liability"),
  }).strict(),
  books: z.object({ observedAt: instant, complete: z.boolean(), balanceUsdc: amount,
    heldUsdc: amount, dailyCommittedUsdc: amount, rollingWeekCommittedUsdc: amount,
    lifetimeCommittedUsdc: amount, categoryCommittedUsdc: z.record(identifier, amount).refine(rows => Object.keys(rows).length <= 16),
    taskCommittedUsdc: z.record(digest, amount).refine(rows => Object.keys(rows).length <= 64 &&
      unique(Object.keys(rows), key => key.toLowerCase())) }).strict(),
  proposal: z.object({ requestId: identifier, question: z.string().min(3).max(4_000),
    taskHash: digest, sourceId: digest, contentHash: digest, category: identifier,
    payee: address, amountUsdc: amount, validUntil: instant,
    recommendation: z.enum(["BUY", "SKIP", "HOLD", "ESCALATE"]),
    rationale: z.string().trim().min(1).max(2_000),
    serving: z.enum(["model", "heuristic", "unknown"]),
    evidenceReview: z.enum(["approved", "rejected", "unknown"]),
  }).strict(),
}).strict();
export type MandateInput = z.infer<typeof mandateInputSchema>;
export interface MandateAssessment {
  schema: "urn:keryx:research-mandate-assessment:1";
  basis: "caller-supplied-policy-and-books";
  executionAuthorized: false;
  assessment: "within-supplied-policy" | "hold" | "skip" | "review";
  evaluatedAt: string;
  reasons: { code: string; message: string }[];
  cash: { protectedReserveUsdc: string; unpaidLiabilitiesUsdc: string; heldUsdc: string; proposedUsdc: string; requiredUsdc: string };
  identity: { decisionHash: Hex; purchaseBinding: Hex; taskHash: Hex; requestId: Hex; network: MandateInput["network"] };
  purchase: { requestId: Hex; taskHash: Hex; sourceId: Hex; contentHash: Hex; decisionHash: Hex;
    category: Hex; payee: Hex; amount: string; validUntil: string };
  prepareCalldata: Hex | null;
}

/** Pure policy evaluation. No model, RPC, signature, payment, receipt trust or storage.
 * The signed/committed contract is a distinct authority, never implied by this projection. */
export function evaluateMandate(raw: unknown, now = new Date()): MandateAssessment {
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > MAX_MANDATE_BYTES)
    throw new Error("Mandate input exceeds 64 KiB");
  const input = mandateInputSchema.parse(raw), { policy, books, proposal } = input;
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid assessment time");
  const reasons: MandateAssessment["reasons"] = [];
  const refuse = (code: string, message: string) => reasons.push({ code, message });
  const toUnits = microUsdc;
  const perPayment = toUnits(policy.perPaymentUsdc), daily = toUnits(policy.dailyUsdc);
  const week = toUnits(policy.rollingWeekUsdc), lifetime = toUnits(policy.lifetimeUsdc);
  if (perPayment === BigInt(0) || perPayment > BigInt(1_000_000_000_000) || daily < perPayment || week < daily || lifetime < week)
    refuse("invalid-policy-limits", "Policy limits must be positive and ordered per purchase, day, rolling week and lifetime.");
  if (Date.parse(policy.expiresAt) <= now.getTime() || Date.parse(policy.expiresAt) > now.getTime() + 365 * 86_400_000)
    refuse("policy-expiry", "The supplied mandate is expired or exceeds the supported duration.");
  const age = now.getTime() - Date.parse(books.observedAt);
  if (!books.complete || age < 0 || age > 30_000) refuse("incomplete-books", "Complete, current books are required; missing observations are not zero liabilities.");
  const payment = toUnits(proposal.amountUsdc), held = toUnits(books.heldUsdc);
  const unpaid = policy.liabilities.filter(row => row.state !== "settled").reduce((sum, row) => sum + toUnits(row.amountUsdc), BigInt(0));
  // Due dates NEVER retire an unpaid obligation. Includes overdue and unknown obligations.
  const bufferedLiabilities = (unpaid * BigInt(11_000) + BigInt(9_999)) / BigInt(10_000);
  const floor = toUnits(policy.reserveFloorUsdc);
  const protectedReserve = bufferedLiabilities > floor ? bufferedLiabilities : floor;
  const required = protectedReserve + held + payment;
  if (payment === BigInt(0) || payment > perPayment) refuse("per-payment-cap", "The proposed amount exceeds its per-purchase authority or is zero.");
  if (!policy.payees.some(row => row.toLowerCase() === proposal.payee.toLowerCase())) refuse("payee-not-allowed", "The recipient is absent from the supplied allowlist.");
  const source = policy.sources.find(row => row.sourceId.toLowerCase() === proposal.sourceId.toLowerCase());
  if (!source || source.payee.toLowerCase() !== proposal.payee.toLowerCase())
    refuse("source-payee-mismatch", "The source must map to its owner-reviewed recipient; a source hash is not payout authority.");
  const category = policy.categories.find(row => row.id === proposal.category);
  const task = policy.tasks.find(row => row.taskHash.toLowerCase() === proposal.taskHash.toLowerCase());
  if (!category || toUnits(category.capUsdc) === BigInt(0)) refuse("category-disabled", "An unset or zero category cap refuses purchases.");
  if (!task || toUnits(task.capUsdc) === BigInt(0)) refuse("task-disabled", "An explicit positive task cap is required.");
  if (keccak256(stringToBytes(proposal.question)).toLowerCase() !== proposal.taskHash.toLowerCase())
    refuse("task-binding-mismatch", "The exact question must match the original task hash.");
  const dailyCommitted = toUnits(books.dailyCommittedUsdc), weeklyCommitted = toUnits(books.rollingWeekCommittedUsdc);
  const lifetimeCommitted = toUnits(books.lifetimeCommittedUsdc);
  if (dailyCommitted > weeklyCommitted || weeklyCommitted > lifetimeCommitted || held > lifetimeCommitted)
    refuse("inconsistent-books", "Committed and held totals are inconsistent; do not infer spare capacity.");
  for (const records of [books.categoryCommittedUsdc, books.taskCommittedUsdc])
    if (Object.values(records).reduce((sum, value) => sum + toUnits(value), BigInt(0)) > lifetimeCommitted)
      refuse("inconsistent-books", "Task and category commitments cannot exceed lifetime commitments.");
  for (const [code, committed, limit] of [["daily-cap", dailyCommitted, daily], ["rolling-week-cap", weeklyCommitted, week],
    ["lifetime-cap", lifetimeCommitted, lifetime]] as const)
    if (committed + payment > limit) refuse(code, "Committed and pending purchases count against this cap.");
  if (category) {
    const committed = books.categoryCommittedUsdc[category.id];
    if (committed === undefined) refuse("category-books-unknown", "The category's committed amount is unavailable.");
    else if (toUnits(committed) + payment > toUnits(category.capUsdc)) refuse("category-cap", "The category commitment would exceed its cap.");
  }
  if (task) {
    const committed = Object.entries(books.taskCommittedUsdc).find(([key]) => key.toLowerCase() === task.taskHash.toLowerCase())?.[1];
    if (committed === undefined) refuse("task-books-unknown", "The task's committed amount is unavailable.");
    else if (toUnits(committed) + payment > toUnits(task.capUsdc)) refuse("task-cap", "The task commitment would exceed its cap.");
  }
  if (required > toUnits(books.balanceUsdc)) refuse("liquidity-short", "Cash must cover unpaid obligations, unresolved exposure and this purchase together.");
  const deadline = Date.parse(proposal.validUntil), midnight = (Math.floor(now.getTime() / 86_400_000) + 1) * 86_400_000;
  if (Math.floor(deadline / 1000) <= Math.floor(now.getTime() / 1000) || deadline >= midnight || deadline > Date.parse(policy.expiresAt))
    refuse("purchase-expiry", "The exact authorization must expire before the next UTC day and within the mandate.");
  if (proposal.serving !== "model") refuse("unverified-agency", "A supplied heuristic or unknown recommendation is not evidence of model agency.");
  if (proposal.evidenceReview !== "approved") refuse("evidence-needs-review", "Supplied evidence review is rejected or unknown; model confidence cannot replace it.");
  const decisionHash = keccak256(stringToBytes(canonicalJson({ schema: input.schema, network: input.network,
    policy, books, proposal, evaluatedAt: now.toISOString() })));
  const purchase = { requestId: keccak256(stringToBytes(proposal.requestId)), taskHash: proposal.taskHash as Hex,
    sourceId: proposal.sourceId as Hex, contentHash: proposal.contentHash as Hex, decisionHash,
    category: keccak256(stringToBytes(proposal.category)), payee: getAddress(proposal.payee), amount: payment,
    validUntil: BigInt(Math.floor(deadline / 1000)) };
  const binding = keccak256(encodeAbiParameters([{ type: "tuple", components: purchaseComponents }], [purchase]));
  const assessment: MandateAssessment["assessment"] = proposal.recommendation === "SKIP" ? "skip"
    : reasons.length > 0 || proposal.recommendation === "HOLD" ? "hold"
    : proposal.recommendation === "ESCALATE" ? "review" : "within-supplied-policy";
  return { schema: "urn:keryx:research-mandate-assessment:1", basis: "caller-supplied-policy-and-books", executionAuthorized: false,
    assessment, evaluatedAt: now.toISOString(), reasons,
    cash: { protectedReserveUsdc: decimalUsdc(protectedReserve), unpaidLiabilitiesUsdc: decimalUsdc(unpaid),
      heldUsdc: decimalUsdc(held), proposedUsdc: decimalUsdc(payment), requiredUsdc: decimalUsdc(required) },
    identity: { decisionHash, purchaseBinding: binding, taskHash: purchase.taskHash, requestId: purchase.requestId, network: input.network },
    purchase: { ...purchase, amount: String(purchase.amount), validUntil: String(purchase.validUntil) },
    prepareCalldata: assessment === "within-supplied-policy" ? encodeFunctionData({ abi: researchMandateAbi, functionName: "prepare", args: [purchase] }) : null };
}
