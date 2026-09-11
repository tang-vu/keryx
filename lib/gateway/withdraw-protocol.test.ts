import { expect, it, vi, afterEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createWalletClient, custom, maxUint256, pad, zeroAddress, type Hex } from "viem";
import { config } from "../config";
import { buildAndSignWithdrawIntent } from "./withdraw-intent";
import { verifyWithdrawRequest, withdrawRequestSchema, withdrawTypedData, type WithdrawPolicy, type WithdrawRequest } from "./withdraw-protocol";

afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const account = privateKeyToAccount(generatePrivateKey());
  const policy: WithdrawPolicy = { owner: account.address, recipient: account.address, domain: 26,
    gatewayWallet: `0x${"11".repeat(20)}`, gatewayMinter: `0x${"22".repeat(20)}`, asset: `0x${"33".repeat(20)}`,
    maxValueMicros: "50000", maxFeeMicros: "5000" };
  const p = (address: Hex) => pad(address, { size: 32 });
  const burnIntent: WithdrawRequest["burnIntent"] = { maxBlockHeight: maxUint256.toString(), maxFee: "5000", spec: {
    version: 1, sourceDomain: 26, destinationDomain: 26, sourceContract: p(policy.gatewayWallet),
    destinationContract: p(policy.gatewayMinter), sourceToken: p(policy.asset), destinationToken: p(policy.asset),
    sourceDepositor: p(account.address), destinationRecipient: p(account.address), sourceSigner: p(account.address),
    destinationCaller: p(zeroAddress), value: "50000", salt: `0x${"45".repeat(32)}`, hookData: "0x",
  } };
  const request: WithdrawRequest = { burnIntent, signature: await account.signTypedData(withdrawTypedData(burnIntent)) };
  return { account, policy, request };
}

it("binds a real EOA signature and stable request identity without network access", async () => {
  vi.stubGlobal("fetch", () => { throw new Error("Network forbidden"); });
  const f = await fixture(), verified = await verifyWithdrawRequest(f.request, f.policy);
  expect(verified.owner).toBe(f.account.address.toLowerCase());
  expect(verified.id).toMatch(/^0x[0-9a-f]{64}$/);
  expect(await verifyWithdrawRequest(JSON.parse(JSON.stringify(f.request)), f.policy)).toEqual(verified);
  const changed = structuredClone(f.request);
  changed.burnIntent.spec.salt = `0x${"56".repeat(32)}`;
  changed.signature = await f.account.signTypedData(withdrawTypedData(changed.burnIntent));
  expect((await verifyWithdrawRequest(changed, f.policy)).id).not.toBe(verified.id);
});

it("rejects foreign owners, changed signed terms and out-of-policy recipients or amounts", async () => {
  const f = await fixture();
  const foreign = privateKeyToAccount(generatePrivateKey());
  await expect(verifyWithdrawRequest(f.request, { ...f.policy, owner: foreign.address })).rejects.toThrow("unavailable");
  for (const field of ["value", "salt", "destinationRecipient", "sourceContract", "sourceToken"] as const) {
    const altered = structuredClone(f.request);
    if (field === "value") altered.burnIntent.spec.value = "49999";
    else altered.burnIntent.spec[field] = `0x${"00".repeat(12)}${"77".repeat(20)}`;
    await expect(verifyWithdrawRequest(altered, f.policy)).rejects.toThrow("unavailable");
  }
  const altered = structuredClone(f.request); altered.burnIntent.maxBlockHeight = "10000";
  await expect(verifyWithdrawRequest(altered, f.policy)).rejects.toThrow("unavailable");
  await expect(verifyWithdrawRequest(f.request, { ...f.policy, maxValueMicros: "49999" })).rejects.toThrow("unavailable");
  await expect(verifyWithdrawRequest(f.request, { ...f.policy, maxFeeMicros: "4999" })).rejects.toThrow("unavailable");
  await expect(verifyWithdrawRequest({ ...f.request, signature: await foreign.signTypedData(withdrawTypedData(f.request.burnIntent)) }, f.policy)).rejects.toThrow("unavailable");
});

it("rejects noncanonical integers, overflow, padded-address aliases and unexpected fields", async () => {
  const f = await fixture();
  for (const value of ["-1", "1e3", "01", " 1", "0", (maxUint256 + BigInt(1)).toString()]) {
    const altered = structuredClone(f.request); altered.burnIntent.spec.value = value;
    expect(withdrawRequestSchema.safeParse(altered).success).toBe(false);
    await expect(verifyWithdrawRequest(altered, f.policy)).rejects.toThrow("unavailable");
  }
  const altered = structuredClone(f.request);
  altered.burnIntent.spec.sourceContract = `0x${"f".repeat(24)}${f.policy.gatewayWallet.slice(2)}`;
  await expect(verifyWithdrawRequest(altered, f.policy)).rejects.toThrow("unavailable");
  await expect(verifyWithdrawRequest({ ...f.request, retry: true }, f.policy)).rejects.toThrow("unavailable");
});

it("captures the authorized request and policy before the caller mutates either", async () => {
  const f = await fixture();
  const promise = verifyWithdrawRequest(f.request, f.policy);
  f.request.burnIntent.spec.value = "1"; f.policy.recipient = `0x${"99".repeat(20)}`;
  expect(await promise).toMatchObject({ recipient: f.account.address.toLowerCase(), request: { burnIntent: { spec: { value: "50000" } } } });
});

it("accepts the actual browser builder's locally signed intent with identical typed-data fields", async () => {
  vi.stubGlobal("fetch", () => { throw new Error("Network forbidden"); });
  const account = privateKeyToAccount(generatePrivateKey());
  const client = createWalletClient({ account, transport: custom({ request: async () => { throw new Error("RPC forbidden"); } }) });
  const request = await buildAndSignWithdrawIntent(client, BigInt(50000));
  const result = await verifyWithdrawRequest(request, {
    owner: account.address, recipient: account.address, domain: config.cctpDomain,
    gatewayWallet: config.gatewayWallet, gatewayMinter: config.gatewayMinter, asset: config.usdcAddress,
    maxValueMicros: "50000", maxFeeMicros: BigInt(Math.round(config.withdrawMaxFeeUsdc * 1e6)).toString(),
  });
  expect(result.request.burnIntent.spec.value).toBe("50000");
  expect(result.owner).toBe(account.address.toLowerCase());
});
