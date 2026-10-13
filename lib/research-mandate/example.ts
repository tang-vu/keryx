import { keccak256, stringToBytes } from "viem";
import type { MandateInput } from "./evaluate";

/** Explicit synthetic scenario, generated when requested rather than pretending to be live books. */
export function mandateExample(now = new Date()): MandateInput {
  const question = "Compare the input and output formats of two public research APIs.";
  const taskHash = keccak256(stringToBytes(question));
  const payee = "0x1111111111111111111111111111111111111111";
  const nextMidnight = (Math.floor(now.getTime() / 86_400_000) + 1) * 86_400_000;
  return { schema: "urn:keryx:research-mandate:1", network: "eip155:5042",
    policy: { perPaymentUsdc: "5", dailyUsdc: "10", rollingWeekUsdc: "20", lifetimeUsdc: "30",
      reserveFloorUsdc: "5", expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      payees: [payee], sources: [{ sourceId: keccak256(stringToBytes("synthetic-source")), payee }],
      categories: [{ id: "source-access", capUsdc: "15" }], tasks: [{ taskHash, capUsdc: "10" }],
      liabilities: [{ id: "unpaid-overdue-source-obligation", amountUsdc: "40",
        dueAt: new Date(now.getTime() - 25 * 3_600_000).toISOString(), state: "open" }] },
    books: { observedAt: now.toISOString(), complete: true, balanceUsdc: "50", heldUsdc: "0",
      dailyCommittedUsdc: "0", rollingWeekCommittedUsdc: "0", lifetimeCommittedUsdc: "0",
      categoryCommittedUsdc: { "source-access": "0" }, taskCommittedUsdc: { [taskHash]: "0" } },
    proposal: { requestId: "synthetic-research-purchase-1", question, taskHash,
      sourceId: keccak256(stringToBytes("synthetic-source")), contentHash: keccak256(stringToBytes("synthetic-version")),
      category: "source-access", payee, amountUsdc: "1", validUntil: new Date(Math.min(now.getTime() + 600_000, nextMidnight - 1000)).toISOString(),
      recommendation: "BUY", rationale: "Synthetic model proposal to cover the API input/output comparison.",
      serving: "model", evidenceReview: "approved" } };
}
