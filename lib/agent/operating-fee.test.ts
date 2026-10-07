import { expect, it, vi } from "vitest";
import { prepareOperatingFee } from "./operating-fee";
import type { Citation } from "../types";
import type { OperatingFeePolicy } from "../payments/operating-fee-policy";

const policy: OperatingFeePolicy = { format: "keryx-operating-fee-policy-v1", network: "eip155:5042", origin: "https://keryx.cc",
  storageIdentityDigest: "a".repeat(64), beneficiary: `0x${"22".repeat(20)}`, expiresAtSeconds: 2_000_000_000 };
function citation(sourceId: string, weight: number, publicSource = true): Citation {
  return { sourceId, sourceName: sourceId, marker: sourceId, weight, reward: 0, rationale: "Qualified excerpt",
    itemUrl: `https://publisher.test/${sourceId}`, ...(publicSource ? { sourceKind: "public-reference" as const } : {}) };
}
it("retains exact original public shares without moving creator or claimed shares", async () => {
  const citations = [citation("owned", 0.4, false), citation("claimed", 0.1), citation("unclaimed", 0.5)];
  const readClaim = vi.fn(async (url: string) => url.endsWith("/claimed") ? { mode: "citation-only" } : null);
  const plan = await prepareOperatingFee({ queryId: "query", poolUsdc: 0.025, citations, policy, readClaim });
  expect(plan?.snapshot.amountUsdc).toBe(0.0125);
  expect(plan?.snapshot.allocations.map(item => item.sourceId)).toEqual(["unclaimed"]);
  expect(plan?.context.amountMicroUsdc).toBe("12500");
  expect(citations.map(item => item.reward)).toEqual([0, 0, 0]);
});
it("withholds unknown ownership, synthetic evidence, insecure URLs and absent citation URLs", async () => {
  const citations = [citation("unknown", 0.25), { ...citation("demo", 0.25), evidenceProvenance: "synthetic-demo" as const },
    { ...citation("http", 0.25), itemUrl: "http://publisher.test/" }, { ...citation("absent", 0.25), itemUrl: undefined }];
  expect(await prepareOperatingFee({ queryId: "query", poolUsdc: 0.025, citations, policy,
    readClaim: async () => { throw new Error("Ownership unavailable"); } })).toBeNull();
});
it("a retained feed claim blocks its article's operating fee without domain inference", async () => {
  const readClaim = vi.fn(async (url: string) => url === "https://publisher.test/" ? { mode: "free" } : null);
  const plan = await prepareOperatingFee({ queryId: "query", poolUsdc: 0.000007, citations: [citation("article", 1)], policy,
    sourceClaimUrls: new Map([["article", ["https://publisher.test/"]]]), readClaim });
  expect(plan).toBeNull();
  expect(readClaim.mock.calls.map(call => call[0])).toEqual(["https://publisher.test/article", "https://publisher.test/"]);
});
it("retains both exact identities for atomic admission and deterministic micro-USDC allocation", async () => {
  const args = { queryId: "query", poolUsdc: 0.000007, citations: [citation("a", 0.5), citation("b", 0.5)], policy,
    sourceClaimUrls: new Map([["a", ["https://publisher.test/", "https://publisher.test/rss"]]]), readClaim: async () => null };
  const plan = await prepareOperatingFee(args);
  expect(plan?.snapshot.allocations.map(item => item.amountUsdc)).toEqual([0.000004, 0.000003]);
  expect(plan?.context.sourceUrls).toEqual(["https://publisher.test/a", "https://publisher.test/", "https://publisher.test/rss", "https://publisher.test/b"]);
  expect(plan?.context.allocationDigest).toBe((await prepareOperatingFee(args))?.context.allocationDigest);
});
