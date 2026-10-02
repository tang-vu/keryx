import { expect, it } from "vitest";
import { gatewayHeldUsdcByChunk } from "./available-balance";
const a = `0x${"11".repeat(20)}`, b = `0x${"22".repeat(20)}`;
const row = { depositor: a, domain: 26, balance: "0.050001", pendingBatch: "0.000001" };
const body = (balances: unknown[]) => ({ token: "USDC", balances });
it("preserves explicit zero and exact micro-USDC pending holdings for only its own chunk", () => {
  const result = gatewayHeldUsdcByChunk(body([{ ...row, depositor: b, balance: "900" }, row]), [a], 26);
  expect(result.get(a)).toBe(0.050002); expect(result.has(b)).toBe(false);
  expect(gatewayHeldUsdcByChunk(body([{ ...row, balance: "0", pendingBatch: "0" }]), [a], 26).get(a)).toBe(0);
});
it("keeps missing, malformed, wrong-domain and duplicate entries unknown", () => {
  for (const value of [body([]), { token: "OTHER", balances: [row] }, body([row, row]),
    body([{ depositor: a }]), body([{ ...row, domain: 0 }]), body([{ ...row, pendingBatch: undefined }])])
    expect(gatewayHeldUsdcByChunk(value, [a], 26).get(a)).toBeNull();
  for (const balance of ["-1", "Infinity", "NaN", "1e3", "0.0000001", "9007199254740992", 1])
    expect(gatewayHeldUsdcByChunk(body([{ ...row, balance }]), [a], 26).get(a)).toBeNull();
  expect(gatewayHeldUsdcByChunk(body([row, { ...row, balance: "bad" }]), [a], 26).get(a)).toBeNull();
});
