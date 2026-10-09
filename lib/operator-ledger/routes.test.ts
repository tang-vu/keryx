import { afterEach, expect, it, vi } from "vitest";
import { operatorLedgerResponse } from "./routes";
import { fetchOperatorLedger, verifyBrowserOperatorLedger } from "./client";
import { ledgerFixture } from "./test-fixture";
import { publicJobLedgerOpenApiPath, publicJobLedgerOpenApiSchema } from "./openapi";
import { operatorLedgerPayloadSchema } from "./contracts";

afterEach(() => vi.unstubAllGlobals());

it("returns no-store JSON/CSV with the same retained digest and uniform bounded errors", async () => {
  const ledger = ledgerFixture(), read = vi.fn(async () => ledger);
  const json = await operatorLedgerResponse(new Request("https://keryx.test/api/operator/ledger?download=1"), read);
  expect(json.headers.get("cache-control")).toBe("no-store"); expect(json.headers.get("x-keryx-ledger-digest")).toBe(ledger.integrity.digest);
  expect(json.headers.get("content-disposition")).toContain("7d.json"); expect(await json.json()).toEqual(ledger);
  const csv = await operatorLedgerResponse(new Request("https://keryx.test/api/operator/ledger?format=csv"), read);
  expect(csv.headers.get("content-type")).toContain("text/csv"); expect(await csv.text()).toContain(ledger.integrity.digest);
  const failed = await operatorLedgerResponse(new Request("https://keryx.test/api/operator/ledger"), async () => { throw new Error("PRIVATE-MANIFEST-PATH"); });
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("PRIVATE-MANIFEST");
});

it.each(["days=0", "days=32", "days=7&days=1", "network=eip155:5042", "wallet=private", "format=xml", "download=0"])(
  "refuses unsupported or duplicate query %s before any native read", async query => {
    const read = vi.fn(async () => ledgerFixture());
    const response = await operatorLedgerResponse(new Request(`https://keryx.test/api/operator/ledger?${query}`), read);
    expect(response.status).toBe(400); expect(read).not.toHaveBeenCalled();
  });

it("validates browser/Node integrity and immutable copies across async WebCrypto", async () => {
  const fixture = ledgerFixture(), retained = fixture.integrity.digest;
  const pending = verifyBrowserOperatorLedger(fixture, retained);
  fixture.payload.entries[0].debitMicroUsdc = "1";
  const result = await pending; expect(result.payload.entries[0].debitMicroUsdc).toBe("15700");
  await expect(verifyBrowserOperatorLedger(fixture)).rejects.toThrow();
});

it("binds hosted origin/window/header and refuses private selectors, redirects or invalid response bytes", async () => {
  const ledger = ledgerFixture(), fetch = vi.fn(async () => new Response(JSON.stringify(ledger), { headers: { "X-Keryx-Ledger-Digest": ledger.integrity.digest } }));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchOperatorLedger("https://keryx.test")).toEqual(ledger);
  expect(fetch).toHaveBeenCalledWith("https://keryx.test/api/operator/ledger?days=7", expect.objectContaining({ redirect: "error", cache: "no-store" }));
  for (const origin of ["http://remote.test", "https://user:secret@keryx.test", "https://keryx.test/private"])
    await expect(fetchOperatorLedger(origin)).rejects.toThrow("refused");
  fetch.mockImplementation(async () => new Response(JSON.stringify(ledger)));
  await expect(fetchOperatorLedger("https://keryx.test")).rejects.toThrow("binding mismatch");
});

it("documents the exact top-level public contract and read-only role without invoice/customer authority", () => {
  const payload = publicJobLedgerOpenApiSchema.properties.payload;
  expect(Object.keys(payload.properties).sort()).toEqual(Object.keys(operatorLedgerPayloadSchema.shape).sort());
  expect(publicJobLedgerOpenApiPath.get.security).toEqual([]);
  expect(publicJobLedgerOpenApiPath.get.description).toMatch(/partial/); expect(publicJobLedgerOpenApiPath.get.description).toMatch(/questions\/customer identities/);
});
