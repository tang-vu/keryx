import { expect, it, vi } from "vitest";
import type { Source } from "../types";
import { pendingPaymentFrom, settledPaymentFrom } from "./payment-state";

const transport = vi.hoisted(() => vi.fn());
vi.mock("./server-x402-client", () => ({ payWithServerSigner: transport }));
import { RealGateway } from "./real-gateway";

it("omits the job from treasury transport but retains it in successful and uncertain payment records", async () => {
  const payer = `0x${"11".repeat(20)}`, payee = `0x${"22".repeat(20)}`;
  const source: Source = { id: "source", name: "Source", url: "https://example.test", description: "Synthetic", walletAddress: payee,
    fetchPrice: 0.002, tags: [], authors: [], createdAt: "2026-09-09T00:00:00.000Z" };
  // Exercise the actual method without constructing/loading/funding a treasury wallet.
  const context = { spend: { address: payer }, batchScheme: {} } as unknown as RealGateway;
  for (const state of ["delivered", "pending", "settled-undelivered"] as const) {
    transport.mockResolvedValueOnce({ delivered: state === "delivered", settlementStatus: state === "pending" ? "pending" : "settled",
      transaction: state === "pending" ? null : "synthetic-reference", authorizationId: `0x${"33".repeat(32)}`,
      authorizationExpiresAt: "2026-09-16T00:00:00.000Z", amountUsdc: 0.002 });
    const args = { source, author: { name: "Author", walletAddress: payee, splitWeight: 1 }, amount: 0.002,
      weight: 1, queryId: "private-job-transport-marker", rationale: "Private rationale marker" };
    let payment;
    try { payment = await RealGateway.prototype.payCitation.call(context, args); }
    catch (error) { payment = pendingPaymentFrom(error) ?? settledPaymentFrom(error); }
    expect(payment).toMatchObject({ queryId: args.queryId, kind: "citation", payee, amountUsdc: 0.002,
      settlementStatus: state === "pending" ? "pending" : "settled" });
    const sent = transport.mock.lastCall![0];
    expect(JSON.stringify(sent)).not.toContain(args.queryId);
    expect(JSON.stringify(sent)).not.toContain(args.rationale);
    expect(sent).toMatchObject({ method: "POST", expectedPayee: payee, expectedAmount: 0.002 });
    expect([...new URL(sent.url, "https://synthetic.example").searchParams.keys()].sort()).toEqual(["amount", "author"]);
  }
});
