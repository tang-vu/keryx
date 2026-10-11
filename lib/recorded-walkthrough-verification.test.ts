import { readFileSync } from "node:fs";
import { encodeFunctionResult } from "viem";
import { expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE } from "./arc-network-profile";
import { readResearchAdmission, recordedWalkthrough } from "./recorded-walkthrough";
import {
  checkCircleTransfer, checkRegistryPayout, readCircleTransfer, readRegistryPayout, recordedPayment,
} from "./recorded-walkthrough-verification";
import { REGISTRY_ABI } from "./registry/registry-abi";

const receipt = JSON.parse(readFileSync("fixtures/walkthrough/recorded-mainnet-receipt.json", "utf8"));
const signal = () => new AbortController().signal;

/** Circle's public record for the retained transfer, as read on October 11, 2026. */
const circleRecord = {
  id: "f2751e74-754b-48a7-b416-6e682410ac9f", status: "completed", token: "USDC",
  sendingNetwork: "eip155:5042", recipientNetwork: "eip155:5042",
  fromAddress: "0x9e88d16c3ecb07b9e84df13ef38dd6b673bd285c", toAddress: "0x3d609ef127094624cc434aad5a9faca0851daa2d",
  amount: "25000", nonce: "0x28d620987cd404a5056974be29d66f02ff90daec2031a8c1cfaa7310fc5a344c",
  txHash: "0x50f6a023f39ea6133518a30460e6f556fa61d701d98cf0947fb6b38aff6880a2",
  createdAt: "2026-10-08T04:42:03.142Z", updatedAt: "2026-10-08T04:44:04.061Z",
};

function registryBatch(payoutWallet: string = recordedPayment.payee, active = true, chainId = "0x13b2") {
  const wallet = payoutWallet as `0x${string}`;
  return [
    { jsonrpc: "2.0", id: 2, result: encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: {
      creator: wallet, payoutWallet: wallet, authors: [{ wallet, basisPoints: 10_000 }],
      fetchPriceUsdc6: BigInt(2_000), contentCid: "", tags: "", active,
    } }) },
    { jsonrpc: "2.0", id: 1, result: chainId },
  ];
}

it("pins the expected payment to the retained, digest-checked receipt", () => {
  const { dispatch, settlement } = receipt.payload;
  expect(settlement.creatorPayments).toHaveLength(1);
  const payment = settlement.creatorPayments[0];
  const micros = (value: number) => Math.round(value * 1_000_000);
  expect(receipt.integrity.digest).toBe(recordedWalkthrough.digest);
  expect(payment).toMatchObject({
    kind: "citation", status: "settled", network: recordedPayment.network, payee: recordedPayment.payee,
    sourceId: recordedPayment.sourceId, circleTransferId: recordedWalkthrough.circleTransferId,
  });
  expect(micros(payment.amountUsdc)).toBe(recordedPayment.citationMicros);
  expect(micros(settlement.settledCitationUsdc)).toBe(recordedPayment.citationMicros);
  expect(micros(settlement.settledAccessUsdc)).toBe(recordedPayment.accessMicros);
  expect(micros(settlement.pendingCreatorUsdc)).toBe(recordedPayment.pendingMicros);
  expect(micros(settlement.failedCreatorUsdc)).toBe(recordedPayment.failedMicros);
  expect(micros(dispatch.budgetUsdc)).toBe(recordedPayment.budgetMicros);
  expect(settlement.operatingPayments).toBeUndefined();
  expect(recordedPayment.network).toBe("eip155:5042");
  expect(recordedPayment.circleTransferUrl).toBe(`https://gateway-api.circle.com/v1/x402/transfers/${payment.circleTransferId}`);
  expect(recordedPayment.rpcUrl).toBe(ARC_MAINNET_PROFILE.rpcUrl);
});

it("accepts Circle's record only when every payment-critical field matches the receipt", () => {
  expect(checkCircleTransfer(circleRecord)).toBe("completed");
  expect(checkCircleTransfer({ ...circleRecord, toAddress: circleRecord.toAddress.toUpperCase().replace("0X", "0x") })).toBe("completed");
  for (const changed of [
    { id: "00000000-0000-4000-8000-000000000000" }, { token: "EURC" }, { amount: "24999" }, { amount: "25000.0" },
    { sendingNetwork: "eip155:5042002" }, { recipientNetwork: "eip155:5042002" },
    { toAddress: circleRecord.fromAddress },
  ]) expect(checkCircleTransfer({ ...circleRecord, ...changed })).toBe("mismatch");
});

it("never reports an unfinished, failed, unknown or malformed Circle record as completed", () => {
  for (const status of ["received", "batched", "confirmed"]) expect(checkCircleTransfer({ ...circleRecord, status })).toBe("progressing");
  expect(checkCircleTransfer({ ...circleRecord, status: "failed" })).toBe("failed");
  expect(checkCircleTransfer({ ...circleRecord, status: "failed", amount: "1" })).toBe("mismatch");
  expect(() => checkCircleTransfer({ ...circleRecord, status: "settled" })).toThrow("Unknown");
  for (const malformed of [null, [], "completed", { status: "completed" }, { ...circleRecord, amount: 25000 }])
    expect(() => checkCircleTransfer(malformed)).toThrow("Invalid");
});

it("reads the transfer from Circle with one credential-free bounded GET and no retry", async () => {
  const fetcher = vi.fn(async () => Response.json(circleRecord));
  expect(await readCircleTransfer(signal(), fetcher)).toBe("completed");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([recordedPayment.circleTransferUrl, expect.objectContaining({
    method: "GET", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: expect.any(AbortSignal),
  })]);
  const missing = vi.fn(async () => new Response("Not found", { status: 404 }));
  await expect(readCircleTransfer(signal(), missing)).rejects.toThrow("unavailable");
  expect(missing).toHaveBeenCalledTimes(1);
  await expect(readCircleTransfer(signal(), async () => new Response("x".repeat(65_537)))).rejects.toThrow("size limit");
  await expect(readCircleTransfer(signal(), async () => new Response("<html>"))).rejects.toThrow();
});

it("binds the Arc registry payout wallet to the recorded payee on attested mainnet only", () => {
  expect(checkRegistryPayout(registryBatch())).toBe("registered");
  expect(checkRegistryPayout(registryBatch("0x3d609eF127094624cC434aAd5A9fAcA0851dAa2D"))).toBe("registered");
  expect(checkRegistryPayout(registryBatch("0x9e88d16c3ecb07b9e84df13ef38dd6b673bd285c"))).toBe("changed");
  expect(checkRegistryPayout(registryBatch(recordedPayment.payee, false))).toBe("changed");
  expect(() => checkRegistryPayout(registryBatch(recordedPayment.payee, true, "0x4cef52"))).toThrow("chain ID");
});

it("refuses malformed, partial, duplicated or error Arc RPC responses", () => {
  const [call, chain] = registryBatch();
  for (const malformed of [
    null, {}, [], [call], [call, call], [call, chain, chain], [call, { ...chain, result: 5042 }],
    [{ jsonrpc: "2.0", id: 2, error: { code: -32000, message: "execution reverted" } }, chain],
  ]) expect(() => checkRegistryPayout(malformed)).toThrow("Invalid Arc RPC response");
  expect(() => checkRegistryPayout([{ ...call, result: "0x" }, chain])).toThrow();
});

it("reads the registry with one credential-free JSON-RPC batch to the pinned contract", async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(registryBatch()));
  expect(await readRegistryPayout(signal(), fetcher)).toBe("registered");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://rpc.blockdaemon.mainnet.arc.io");
  expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store" });
  const body = JSON.parse(String(init!.body));
  expect(body.map((entry: { method: string }) => entry.method)).toEqual(["eth_chainId", "eth_call"]);
  expect(body[1].params[0].to).toBe("0x42a64061b6cd84067bb660b2a9b8aa881fd225bb");
  expect(body[1].params[0].data.endsWith(recordedPayment.sourceId.slice(2))).toBe(true);
  expect(body[1].params[1]).toBe("latest");
  await expect(readRegistryPayout(signal(), async () => new Response("Busy", { status: 429 }))).rejects.toThrow("unavailable");
});

it("reads the public pause observation without treating it as admission", async () => {
  const paused = vi.fn(async () => Response.json({ state: "paused", message: "<b>ignored</b>" }));
  expect(await readResearchAdmission(signal(), paused)).toBe("paused");
  expect(paused.mock.calls[0]).toEqual(["/api/research/availability", expect.objectContaining({ method: "GET", credentials: "omit", redirect: "error" })]);
  expect(await readResearchAdmission(signal(), async () => Response.json({ state: "not-paused" }))).toBe("not-paused");
  await expect(readResearchAdmission(signal(), async () => Response.json({ state: "open" }))).rejects.toThrow("unavailable");
  await expect(readResearchAdmission(signal(), async () => new Response("Down", { status: 502 }))).rejects.toThrow("unavailable");
});
