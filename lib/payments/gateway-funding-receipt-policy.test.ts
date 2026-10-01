import { expect,it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { GATEWAY_FUNDING_RECEIPT_POLICY as policy,GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST as digest,
  GATEWAY_FUNDING_RECEIPT_RPC_METHODS,assertGatewayFundingReceiptPolicy } from "./gateway-funding-receipt-policy";
it("pins distinct documented HTTPS providers, bounds and read-only methods into immutable owner digest",()=>{
  expect(Object.isFrozen(policy)).toBe(true);
  expect(new URL(policy.primary).origin).not.toBe(new URL(policy.secondary).origin);
  for(const endpoint of [policy.primary,policy.secondary]) expect(new URL(endpoint).protocol).toBe("https:");
  expect(digest).toBe(createHash("sha256").update(canonicalJson(policy)).digest("hex"));
  expect(GATEWAY_FUNDING_RECEIPT_RPC_METHODS).toEqual(["eth_chainId","eth_getTransactionByHash","eth_getTransactionReceipt","eth_getBlockByNumber"]);
  expect(()=>assertGatewayFundingReceiptPolicy(digest)).not.toThrow();
  for(const value of [true,{},"a".repeat(64)]) expect(()=>assertGatewayFundingReceiptPolicy(value)).toThrow("refused");
});
