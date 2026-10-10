import { describe, expect, it, vi } from "vitest";
import { createTrustedUsageContext, newRunUsage, parseRunUsage } from "./usage-provenance";
const network = "eip155:5042", wallet = `0x${"a".repeat(40)}`, proof = "a".repeat(64);
const outside = { actor: "outside", funding: "independent", scripted: false, actorEvidenceSha256: proof, fundingEvidenceSha256: proof } as const;
describe("server-local usage evidence", () => {
  it("public copies, channel labels and unverified wallets establish no trusted cohort or funding", () => {
    for (const usageContext of [outside, {}, JSON.parse(JSON.stringify(createTrustedUsageContext(network, outside)))])
      expect(newRunUsage({ usageContext, asker: wallet }, network, [wallet])).toMatchObject({ cohort: "unknown", payment: "unknown" });
    const provenance = { version: 1, surface: "cli", ownershipMethod: "unknown" } as const;
    expect(newRunUsage({ asker: wallet, provenance }, network, [wallet]).cohort).toBe("unknown");
    expect(newRunUsage({ asker: wallet, provenance: { ...provenance, ownershipMethod: "api-key" } }, network, [wallet])).toMatchObject({ cohort: "team", payment: "team" });
  });
  it("requires separate outside actor and funding evidence; sponsors and treasury never become outside payers", () => {
    expect(() => createTrustedUsageContext(network, { ...outside, actorEvidenceSha256: undefined })).toThrow();
    expect(() => createTrustedUsageContext(network, { ...outside, fundingEvidenceSha256: undefined })).toThrow();
    for (const [funding, payment] of [["independent", "independent"], ["sponsored", "sponsored"], ["treasury", "team"], ["unknown", "unknown"]] as const) {
      const token = createTrustedUsageContext(network, { ...outside, funding });
      expect(newRunUsage({ usageContext: token }, network, [])).toMatchObject({ cohort: "outside", payment });
      expect(newRunUsage({ usageContext: token }, "eip155:5042002", []).cohort).toBe("unknown");
    }
  });
  it("controlled scripted runs are excluded without manufacturing team funding evidence", () => {
    const token = createTrustedUsageContext(network, { actor: "unknown", funding: "unknown", scripted: true });
    expect(newRunUsage({ usageContext: token }, network, [])).toMatchObject({ cohort: "scripted", payment: "unknown" });
  });
  it("closed parsing refuses accessors, unknown fields/enums and absent historical evidence", () => {
    const usage = newRunUsage({ usageContext: createTrustedUsageContext(network, outside) }, network, []);
    const getter = vi.fn(() => "outside"), accessor = Object.defineProperty({ ...usage }, "cohort", { get: getter });
    for (const value of [null, {}, accessor, { ...usage, client: "team" }, { ...usage, cohort: "other" },
      { ...usage, actorEvidenceSha256: null }, { ...usage, fundingEvidenceSha256: null }, { ...usage, version: 2 }])
      expect(parseRunUsage(value)).toBeUndefined();
    expect(() => createTrustedUsageContext(network, accessor as never)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(parseRunUsage(usage)).toEqual(usage);
  });
});
