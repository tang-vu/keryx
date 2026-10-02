import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
async function buyer(content?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-mcp-custody-")); dirs.push(dir);
  const wallet = path.join(dir, "wallet.json");
  if (content !== undefined) fs.writeFileSync(wallet, content);
  vi.stubEnv("KERYX_BUYER_PRIVATE_KEY", undefined); vi.stubEnv("KERYX_BUYER_PAYEE", undefined);
  vi.stubEnv("KERYX_WALLET_FILE", wallet); vi.stubEnv("KERYX_PAYMENT_JOURNAL", path.join(dir, "payment.json"));
  const fetcher = vi.fn(() => { throw new Error("Network forbidden"); }); vi.stubGlobal("fetch", fetcher);
  vi.resetModules();
  return { api: await import("./keryx-buyer.mts"), wallet, dir, fetcher };
}
it("initializes metadata and missing-custody status without creating files or attempting network", async () => {
  const f = await buyer();
  expect(f.api.meta.baseUrl).toBeDefined(); expect(fs.readdirSync(f.dir)).toEqual([]);
  expect(await f.api.getStatus()).toMatchObject({ address: "unconfigured", ready: false });
  await expect(f.api.askKeryx("Synthetic research")).rejects.toThrow(/No wallet is created/);
  expect(fs.readdirSync(f.dir)).toEqual([]); expect(f.fetcher).not.toHaveBeenCalled();
});
it("preserves an unreadable custody file and refuses replacing it", async () => {
  const f = await buyer("{broken legacy wallet}");
  expect(await f.api.getStatus()).toMatchObject({ ready: false });
  await expect(f.api.askKeryx("Synthetic research")).rejects.toThrow(/Preserve any old wallet/);
  expect(fs.readFileSync(f.wallet, "utf8")).toBe("{broken legacy wallet}"); expect(f.fetcher).not.toHaveBeenCalled();
});
it("requires independent merchant policy before any funding or network even with configured custody", async () => {
  const f = await buyer(); vi.stubEnv("KERYX_BUYER_PRIVATE_KEY", `0x${"11".repeat(32)}`);
  await expect(f.api.askKeryx("Synthetic research")).rejects.toThrow(/independently reviewed seller/);
  expect(f.fetcher).not.toHaveBeenCalled(); expect(fs.readdirSync(f.dir)).toEqual([]);
});

it.each([
  ["KERYX_A2A_MAX_BUDGET", "NaN"], ["KERYX_MAX_TOTAL_USDC", "Infinity"],
  ["KERYX_A2A_DEEP_FEE", "0.0500001"], ["KERYX_DEFAULT_BUDGET", "0.0000001"],
] as const)("rejects invalid %s precision/configuration before effects", async (name, value) => {
  const f = await buyer(); vi.stubEnv("KERYX_BUYER_PRIVATE_KEY", `0x${"11".repeat(32)}`);
  vi.stubEnv("KERYX_BUYER_PAYEE", `0x${"22".repeat(20)}`); vi.stubEnv(name, value); vi.resetModules();
  const api = await import("./keryx-buyer.mts");
  await expect(api.askKeryx("Synthetic research")).rejects.toThrow(/micro-USDC/);
  expect(await api.getStatus()).toMatchObject({ ready: false, gatewayAvailable: "unknown", instructions: expect.stringContaining("policy is invalid") });
  expect(f.fetcher).not.toHaveBeenCalled(); expect(fs.readdirSync(f.dir)).toEqual([]);
});

it.each(["payment.json.lock", "payment.json.funding.json.lock"])("retains %s after a journal-cleared crash and refuses funding before network", async (lock) => {
  const f = await buyer();
  vi.stubEnv("KERYX_BUYER_PRIVATE_KEY", `0x${"11".repeat(32)}`);
  vi.stubEnv("KERYX_BUYER_PAYEE", `0x${"22".repeat(20)}`); vi.resetModules();
  fs.mkdirSync(path.join(f.dir, lock));
  const api = await import("./keryx-buyer.mts");
  expect(await api.getStatus()).toMatchObject({ ready: false, gatewayAvailable: "unknown", instructions: expect.stringContaining("admission is held") });
  await expect(api.askKeryx("Synthetic research")).rejects.toThrow(/before any new funding/);
  expect(fs.readdirSync(f.dir)).toEqual([lock]); expect(f.fetcher).not.toHaveBeenCalled();
});
