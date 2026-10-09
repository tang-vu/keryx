import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), close: vi.fn() }));
vi.mock("../db/application-storage", () => ({ createReadonlyApplicationStorage: mocks.create, closeReadonlyApplicationStorage: mocks.close }));
vi.mock("../config", () => ({ config: { networkId: "eip155:5042002" } }));
import { GET } from "../../app/api/operator/ledger/route";
import { ledgerRun } from "./test-fixture";

it("actual API is public only over the protected readonly factory and closes its handle", async () => {
  const reader = { async *iterateRecentQueries() { yield ledgerRun({ settledPayments: 0 }); }, async listPayments() { return []; } };
  mocks.create.mockResolvedValue(reader);
  const result = await GET(new Request("http://localhost/api/operator/ledger"));
  expect(result.status).toBe(200); expect(mocks.close).toHaveBeenCalledWith(reader);
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

it("uses the provenance-bound terminal closer without probing undeclared Supabase facade properties", async () => {
  const reader = new Proxy({ async *iterateRecentQueries() { yield ledgerRun({ settledPayments: 0 }); }, async listPayments() { return []; } }, {
    get(target, property) { if (property === "then") return undefined; if (!(property in target)) throw new Error("Undeclared native facade property"); return Reflect.get(target, property); },
  });
  mocks.create.mockResolvedValue(reader);
  const response = await GET(new Request("http://localhost/api/operator/ledger"));
  expect(response.status).toBe(200); expect(mocks.close.mock.calls.at(-1)?.[0] === reader).toBe(true);
});
