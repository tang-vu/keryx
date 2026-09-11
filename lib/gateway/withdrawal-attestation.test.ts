import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createWalletClient, custom, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { buildAndSignWithdrawIntent } from "./withdraw-intent";
import { createWithdrawalRequest } from "./withdrawal-request";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";

async function fixture() {
  const account = privateKeyToAccount(generatePrivateKey());
  const client = createWalletClient({ account, transport: custom({ request: async () => { throw new Error("RPC forbidden"); } }) });
  const record = await createWithdrawalRequest(await buildAndSignWithdrawIntent(client, BigInt(50000)), {
    owner: account.address, recipient: account.address, domain: config.cctpDomain,
    gatewayWallet: config.gatewayWallet, gatewayMinter: config.gatewayMinter, asset: config.usdcAddress,
    maxValueMicros: "50000", maxFeeMicros: BigInt(Math.round(config.withdrawMaxFeeUsdc * 1e6)).toString(),
  });
  // Explicit layout from pinned Solidity format; signature is synthetic, not Circle proof.
  const s = record.request.burnIntent.spec;
  const spec = "ca85def7000000010000001a0000001a" +
    [s.sourceContract,s.destinationContract,s.sourceToken,s.destinationToken,s.sourceDepositor,
      s.destinationRecipient,s.sourceSigner,s.destinationCaller].map(value => value.slice(2)).join("") +
    BigInt(50000).toString(16).padStart(64,"0") + s.salt.slice(2) + "00000000";
  const payload = `0xff6fb334${BigInt(10000).toString(16).padStart(64,"0")}00000154${spec}` as Hex;
  return { record, response: { transferId: randomUUID(), attestation: payload,
    signature: `0x${"12".repeat(65)}` as Hex, expirationBlock: "10000" } };
}

it("matches a single attestation or one-entry set without claiming signature authority or settlement", async () => {
  const { record, response } = await fixture();
  const matched = await matchWithdrawalAttestation(record, response);
  expect(matched).toMatchObject({ authority: "request-matched-only", requestId: record.id, expirationBlock: "10000" });
  expect(matched.transferSpecHash).not.toBe(record.id);
  const set = { ...response, attestation: `0x1e12db7100000001${response.attestation.slice(2)}` };
  expect(await matchWithdrawalAttestation(record, set)).toMatchObject({ transferSpecHash: matched.transferSpecHash, attestation: set.attestation });
});

it("rejects changed routing, amount, salt, lengths and magic even when the JSON response looks successful", async () => {
  const { record, response } = await fixture();
  // Offsets span every signed TransferSpec field and both encoding headers.
  for (const byte of [0,36,40,44,48,52,56,88,120,152,184,216,248,280,312,344,376]) {
    const offset = 2 + byte * 2;
    const changed = response.attestation.slice(0,offset) + (response.attestation.slice(offset,offset+2) === "ff" ? "ee" : "ff") + response.attestation.slice(offset+2);
    await expect(matchWithdrawalAttestation(record, { ...response, attestation: changed, success: true })).rejects.toThrow("unavailable");
  }
  for (const attestation of ["0x", response.attestation.slice(0,-2), response.attestation+"00",
    `0x1e12db7100000002${response.attestation.slice(2)}`, `0x1e12db7100000000${response.attestation.slice(2)}`]) {
    await expect(matchWithdrawalAttestation(record, { ...response, attestation })).rejects.toThrow("unavailable");
  }
});

it("rejects inconsistent expiry or vendor error and snapshots the response before verification awaits", async () => {
  const { record, response } = await fixture();
  for (const expirationBlock of ["9999", "0", "1e4", "010000"]) {
    await expect(matchWithdrawalAttestation(record, { ...response, expirationBlock })).rejects.toThrow("unavailable");
  }
  await expect(matchWithdrawalAttestation(record, { ...response, success: false })).rejects.toThrow("unavailable");
  await expect(matchWithdrawalAttestation(record, { ...response, error: "unavailable" })).rejects.toThrow("unavailable");
  const promise = matchWithdrawalAttestation(record, response);
  response.attestation = "0x00";
  expect(await promise).toMatchObject({ requestId: record.id, expirationBlock: "10000" });
});
