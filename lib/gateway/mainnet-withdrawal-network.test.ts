import { afterEach, expect, it, vi } from "vitest";
import { createPublicClient, custom, pad, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { prepareWithdrawIntentForProfile } from "./withdraw-intent-core";
import { withdrawTypedData, type WithdrawPolicy } from "./withdraw-protocol";
import { createWithdrawalRequest, validateWithdrawalRequest } from "./withdrawal-request";
import { estimateWithdrawalIntent } from "./withdrawal-estimate";
import { requestCircleWithdrawalTransfer } from "./withdrawal-transfer-service";
import { readWithdrawalHeightWindow } from "./withdrawal-height-window";

afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const signer = privateKeyToAccount(`0x${"12".repeat(32)}`), recipient = `0x${"34".repeat(20)}` as Hex;
  const p = ARC_MAINNET_PROFILE;
  const policy: WithdrawPolicy = { owner: signer.address.toLowerCase() as Hex, recipient, domain: p.cctpDomain,
    gatewayWallet: p.gatewayWallet.toLowerCase() as Hex, gatewayMinter: p.gatewayMinter.toLowerCase() as Hex,
    asset: p.usdcAddress.toLowerCase() as Hex, maxValueMicros: "50000", maxFeeMicros: "100" };
  const burnIntent = { ...prepareWithdrawIntentForProfile(p, signer.address, "50000", recipient, "100"), maxBlockHeight: "20000" };
  const signature = await signer.signTypedData(withdrawTypedData(burnIntent));
  const record = await createWithdrawalRequest({ burnIntent, signature }, policy, p);
  return { signer, policy, burnIntent, record };
}
it("binds a mainnet withdrawal to exact static contracts and retains its original network", async () => {
  const { record, policy } = await fixture();
  expect(record.format).toBe("creator-withdrawal-request-v2");
  expect(record.network).toBe("eip155:5042");
  expect(await validateWithdrawalRequest(record)).toEqual(record);
  await expect(validateWithdrawalRequest({ ...record, network: ARC_TESTNET_PROFILE.networkId,
    format: "creator-withdrawal-request-v1" })).rejects.toThrow();
  await expect(createWithdrawalRequest(record.request, policy, { ...ARC_MAINNET_PROFILE })).rejects.toThrow();
  await expect(createWithdrawalRequest(record.request, { ...policy, gatewayWallet: ARC_TESTNET_PROFILE.gatewayWallet }, ARC_MAINNET_PROFILE)).rejects.toThrow();
  await expect(createWithdrawalRequest(record.request, { ...policy, asset: `0x${"56".repeat(20)}` }, ARC_MAINNET_PROFILE)).rejects.toThrow();
  const wrongRecipient = structuredClone(record);
  wrongRecipient.request.burnIntent.spec.destinationRecipient = pad(record.owner as Hex, { size: 32 });
  await expect(validateWithdrawalRequest(wrongRecipient)).rejects.toThrow();
});

it("uses fixed original mainnet estimate/transfer endpoints without retrying a signed request", async () => {
  const { record, policy, burnIntent } = await fixture(), calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push(url); expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/estimate")) {
      expect(body).toEqual([{ spec: burnIntent.spec }]);
      expect(String(init.body)).not.toContain(record.request.signature);
      return Response.json([{ burnIntent }]);
    }
    expect(body).toEqual([record.request]);
    return Response.json({ error: "SYNTHETIC PRIVATE DETAIL" }, { status: 503 });
  }));
  const signal = new AbortController().signal;
  expect(await estimateWithdrawalIntent(burnIntent, policy, { minimumBlockHeight: "19000", maximumBlockHeight: "21000" },
    signal, ARC_MAINNET_PROFILE)).toEqual(burnIntent);
  await expect(requestCircleWithdrawalTransfer(record, signal)).rejects.toThrow(/^Withdrawal transfer response unavailable$/);
  expect(calls).toEqual(["https://gateway-api.circle.com/v1/estimate", "https://gateway-api.circle.com/v1/transfer"]);
});

it("attests mainnet chain and metadata both before and after a pinned fresh block", async () => {
  const { policy } = await fixture();
  const state = { chain: 5042, hash: `0x${"ab".repeat(32)}` as Hex, network: "Mainnet", reads: 0, drift: false };
  const client = createPublicClient({ transport: custom({ request: async ({ method }) => {
    if (method === "eth_chainId") return toHex(state.chain);
    if (method === "eth_getBlockByNumber") { state.reads++;
      return { number: toHex(10000), timestamp: toHex(Math.floor(Date.now() / 1000)),
        hash: state.drift && state.reads > 1 ? `0x${"cd".repeat(32)}` : state.hash, transactions: [] }; }
    throw new Error("Unexpected synthetic RPC");
  } }, { retryCount: 0 }) });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    expect(url).toBe("https://gateway-api.circle.com/v1/info");
    return Response.json({ domains: [{ chain: "Arc", network: state.network, domain: 26, processedHeight: "9995",
      burnIntentExpirationHeight: "11000", walletContract: { address: policy.gatewayWallet, supportedTokens: ["USDC"] },
      minterContract: { address: policy.gatewayMinter, supportedTokens: ["USDC"] } }] });
  }));
  const read = () => readWithdrawalHeightWindow(() => client, policy, { maxAheadBlocks: "2000", maxProcessingLagBlocks: "10" },
    new AbortController().signal, ARC_MAINNET_PROFILE);
  expect(await read()).toMatchObject({ minimumBlockHeight: "11000", observedBlockHash: state.hash });
  state.network = "Testnet"; await expect(read()).rejects.toThrow();
  state.network = "Mainnet"; state.chain = 5042002; await expect(read()).rejects.toThrow();
  state.chain = 5042; state.reads = 0; state.drift = true; await expect(read()).rejects.toThrow();
});
