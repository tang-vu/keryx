import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../db/application-storage", () => ({ createReadonlyApplicationStorage: mocks.create }));
vi.mock("../config", () => ({ config: { networkId: "eip155:5042002" } }));
import { GET } from "../../app/api/operator/ledger/route";
import { ledgerRun } from "./test-fixture";

it("actual API is public only over the protected readonly factory and closes its handle", async () => {
  const close = vi.fn();
  mocks.create.mockResolvedValue({ async *iterateRecentQueries() { yield ledgerRun({ settledPayments: 0 }); }, async listPayments() { return []; }, close });
  const result = await GET(new Request("http://localhost/api/operator/ledger"));
  expect(result.status).toBe(200); expect(close).toHaveBeenCalledOnce();
  const payload = (await result.json()).payload;
  expect(payload.network).toBe("eip155:5042002"); expect(payload.business.profitMicroUsdc).toBeNull();
});

it("actual API never falls back to an ordinary writer or leaks sealed-store errors", async () => {
  for (const result of [undefined, new Error("PRIVATE-CUSTODY-STORAGE-PATH")]) {
    if (result instanceof Error) mocks.create.mockRejectedValue(result); else mocks.create.mockResolvedValue(result);
    const response = await GET(new Request("http://localhost/api/operator/ledger"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE-CUSTODY");
  }
});
