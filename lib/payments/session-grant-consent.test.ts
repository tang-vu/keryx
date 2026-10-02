import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage, parseSessionGrantConsent } from "./session-grant-consent";

const fields = { format: "keryx-session-grant-consent-v1", network: "eip155:5042", origin: "https://keryx.example",
  ownerAddr: "0x1111111111111111111111111111111111111111", sessAddr: "0x2222222222222222222222222222222222222222",
  grantEpoch: "a8dedce2-d568-4bb5-8da1-560588ce5eb5", capMicroUsdc: "100000000", expirySeconds: "1800000000" };

it("binds every delegation field and the independently selected financial domain to owner consent", async () => {
  const account = privateKeyToAccount(generatePrivateKey()), grant = { ...fields, ownerAddr: account.address.toLowerCase() };
  const message = createSessionGrantConsentMessage(grant, ARC_MAINNET_PROFILE);
  const signature = await account.signMessage({ message });
  expect((await recoverMessageAddress({ message, signature })).toLowerCase()).toBe(grant.ownerAddr);
  for (const changed of [{ sessAddr: "0x3333333333333333333333333333333333333333" }, { origin: "https://other.example" },
    { grantEpoch: "a8dedce2-d568-4bb5-8da1-560588ce5eb6" }, { capMicroUsdc: "100000001" }, { expirySeconds: "1800000001" }]) {
    expect((await recoverMessageAddress({ message: createSessionGrantConsentMessage({ ...grant, ...changed }, ARC_MAINNET_PROFILE), signature }))
      .toLowerCase()).not.toBe(grant.ownerAddr);
  }
  expect(() => createSessionGrantConsentMessage(grant, ARC_TESTNET_PROFILE)).toThrow();
  expect(createSessionGrantConsentMessage({ ...grant, network: "eip155:5042002" }, ARC_TESTNET_PROFILE)).not.toBe(message);
});
it("refuses malformed, foreign or widened grants without imposing invited-pilot ceilings", () => {
  expect(parseSessionGrantConsent(fields, ARC_MAINNET_PROFILE).capMicroUsdc).toBe("100000000");
  for (const changed of [{ network: "eip155:5042002" }, { origin: "http://keryx.example" }, { origin: "https://keryx.example/" },
    { ownerAddr: fields.sessAddr }, { capMicroUsdc: "01" }, { capMicroUsdc: "9007199254740992" }, { privateKey: "forbidden" }])
    expect(() => parseSessionGrantConsent({ ...fields, ...changed }, ARC_MAINNET_PROFILE)).toThrow();
  expect(() => parseSessionGrantConsent(fields, { ...ARC_MAINNET_PROFILE })).toThrow();
});
it("separates public signer possession from owner delegation and binds its exact one-use grant", async () => {
  const session = privateKeyToAccount(generatePrivateKey()), grant = { ...fields, sessAddr: session.address.toLowerCase() };
  const proof = createSessionGrantSignerProofMessage(grant, ARC_MAINNET_PROFILE), signature = await session.signMessage({ message: proof });
  expect(proof).not.toBe(createSessionGrantConsentMessage(grant, ARC_MAINNET_PROFILE));
  expect((await recoverMessageAddress({ message: proof, signature })).toLowerCase()).toBe(grant.sessAddr);
  for (const mutation of [{ ownerAddr: "0x3333333333333333333333333333333333333333" }, { origin: "https://other.example" },
    { grantEpoch: "a8dedce2-d568-4bb5-8da1-560588ce5eb6" }, { capMicroUsdc: "100000001" }, { expirySeconds: "1800000001" }])
    expect((await recoverMessageAddress({ message: createSessionGrantSignerProofMessage({ ...grant, ...mutation }, ARC_MAINNET_PROFILE), signature }))
      .toLowerCase()).not.toBe(grant.sessAddr);
});
