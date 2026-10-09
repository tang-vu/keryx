import { expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import { captureLedgerRun } from "./capture";
import { readOperatorLedger } from "./read";
import { ledgerRun, ledgerPayment, LEDGER_FIXTURE_TIME } from "./test-fixture";

it("uses bounded native read shapes, closes a capped stream and keeps coverage partial", async () => {
  let returned = false;
  const iterateRecentQueries = vi.fn(async function* (limit: number) {
    expect(limit).toBe(251);
    try { for (let count = 0; count < 1_000; count++) yield ledgerRun({ id: `public-${count}` }); }
    finally { returned = true; }
  });
  const listPayments = vi.fn(async (limit: number) => { expect(limit).toBe(1001); return []; });
  const result = await readOperatorLedger({ iterateRecentQueries, listPayments }, "eip155:5042002", 7, () => LEDGER_FIXTURE_TIME);
  expect(returned).toBe(true); expect(result.payload.jobs).toHaveLength(250); expect(result.payload.scope.runLimitReached).toBe(true);
  expect(result.payload.scope).toMatchObject({ coverage: "partial", consistency: "separate-read-snapshots" });
});

it("copies public run associations before asynchronous payment hydration", async () => {
  const run = ledgerRun();
  const reader = { async *iterateRecentQueries() { yield run; }, async listPayments() {
    run.fundingOwner = "browser"; run.askerFunded = true; run.decisions[0].sourceId = "changed-source";
    return [ledgerPayment()];
  } };
  const result = await readOperatorLedger(reader, "eip155:5042002", 7, () => LEDGER_FIXTURE_TIME);
  expect(result.payload.jobs[0].funding).toBe("treasury"); expect(result.payload.entries).toHaveLength(2);
});

it("refuses oversized/error reader output and invalid selectors instead of hydrating a fallback", async () => {
  const iterateRecentQueries = vi.fn(async function* () { yield ledgerRun(); });
  const huge = { iterateRecentQueries, async listPayments() { return Array(1002).fill(ledgerPayment()); } };
  await expect(readOperatorLedger(huge, "eip155:5042002", 7, () => LEDGER_FIXTURE_TIME)).rejects.toThrow("slice unavailable");
  await expect(readOperatorLedger(huge, "eip155:5042002", 32)).rejects.toThrow("window refused");
  const broken = { async *iterateRecentQueries(): AsyncIterable<QueryRun> { throw new Error("PRIVATE-STORE-ERROR"); }, listPayments: vi.fn() };
  await expect(readOperatorLedger(broken, "eip155:5042002")).rejects.toThrow(); expect(broken.listPayments).not.toHaveBeenCalled();
});

it("caps payments with a sentinel and excludes other networks rather than summing them", async () => {
  const payments = Array.from({ length: 1001 }, (_, n) => ledgerPayment({ id: `original-${n}`, authorizationId: `auth-${n}`, network: "eip155:5042" }));
  const result = await readOperatorLedger({ async *iterateRecentQueries() { yield ledgerRun(); }, async listPayments() { return payments; } },
    "eip155:5042002", 7, () => LEDGER_FIXTURE_TIME);
  expect(result.payload.scope.paymentLimitReached).toBe(true); expect(result.payload.entries).toEqual([]);
  expect(result.payload.jobs[0].legs).toHaveLength(1000); expect(result.payload.jobs[0].legs.every(leg => leg.amountMicroUsdc === null)).toBe(true);
});

it("omits malformed and unproven runs without reading private payloads or invoking getters", () => {
  const getter = vi.fn(() => "PRIVATE-QUESTION");
  const run = ledgerRun(); Object.defineProperty(run, "question", { get: getter, enumerable: true });
  expect(captureLedgerRun(run)).toBeNull(); expect(getter).not.toHaveBeenCalled();
  expect(captureLedgerRun({ ...ledgerRun(), decisions: Array(1001).fill({ sourceId: "source" }) })).toBeNull();
});
