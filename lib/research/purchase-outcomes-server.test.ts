import { beforeEach, describe, expect, it, vi } from "vitest";
import retained from "../../fixtures/purchase-outcomes/retained-testnet.json";
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../history/read-dispatch", () => ({ resolveDispatch: mocks.resolve }));
vi.mock("../config", () => ({ config: { networkId: "eip155:5042" } }));
import { readPublicPurchaseOutcomes } from "./purchase-outcomes-server";
beforeEach(() => vi.clearAllMocks());
describe("public dispatch visibility and archive authority", () => {
  it("uses only the existing resolver, retains its network, and never invokes enrichment readers", async () => {
    const read = vi.fn(() => { throw new Error("Extra ledger or sidecar read forbidden"); });
    mocks.resolve.mockResolvedValue({ run: retained.snapshot, archive: retained.snapshot.archive,
      reader: new Proxy({}, { get() { read(); } }) });
    const result = await readPublicPurchaseOutcomes(retained.snapshot.id);
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(retained.snapshot.id);
    expect(result?.network).toBe("eip155:5042002"); expect(result?.counts.scoredPurchases).toBe(1); expect(read).not.toHaveBeenCalled();
  });
  it("does not select a fallback after the resolver/storage fails", async () => {
    mocks.resolve.mockRejectedValue(new Error("Selected store unavailable"));
    await expect(readPublicPurchaseOutcomes(retained.snapshot.id)).rejects.toThrow("Selected store unavailable");
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    mocks.resolve.mockResolvedValue(null); expect(await readPublicPurchaseOutcomes(retained.snapshot.id)).toBeNull();
  });
  it("refuses unsafe selectors before resolving and excludes observations from a different selected network", async () => {
    await expect(readPublicPurchaseOutcomes("../private")).rejects.toThrow(); expect(mocks.resolve).not.toHaveBeenCalled();
    // Keep the run's stale/look-alike archive property intact. Only resolver
    // metadata may select the historical network/provenance in hosted readers.
    const run = structuredClone(retained.snapshot);
    mocks.resolve.mockResolvedValue({ run, archive: null });
    const result = await readPublicPurchaseOutcomes(run.id);
    expect(result?.network).toBe("eip155:5042"); expect(result?.archive).toBeNull();
    expect(result?.counts.excludedPaymentObservations).toBe(1);
    expect(result?.hitRate).toBeNull();
  });
});
