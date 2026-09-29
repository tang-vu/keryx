import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { PendingSignatureChallenge } from "./pending-signatures";
import { verifyBrowserSignature } from "./verify-browser-signature";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
const payee = `0x${"33".repeat(20)}`;
const nonce = `0x${"44".repeat(32)}`;
const now = 1_800_000_000;
const gateway = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const challenge: PendingSignatureChallenge = {
  expectedSigner: account.address,
  requirements: {
    scheme: "exact", network: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
    amount: "2000", payTo: payee, maxTimeoutSeconds: 691200,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: gateway },
  },
};

async function signedHeader(options: {
  signer?: typeof account;
  chainId?: number;
  verifyingContract?: string;
  to?: string;
  value?: string;
  validBefore?: string;
  nonce?: string;
} = {}): Promise<string> {
  const auth = {
    from: account.address,
    to: options.to ?? payee,
    value: options.value ?? "2000",
    validAfter: String(now - 600),
    validBefore: options.validBefore ?? String(now + 691200),
    nonce: options.nonce ?? nonce,
  };
  const signature = await (options.signer ?? account).signTypedData({
    domain: {
      name: "GatewayWalletBatched", version: "1",
      chainId: options.chainId ?? 5042002,
      verifyingContract: (options.verifyingContract ?? gateway) as `0x${string}`,
    },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from, to: auth.to as `0x${string}`,
      value: BigInt(auth.value), validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore), nonce: auth.nonce as `0x${string}`,
    },
  });
  return Buffer.from(JSON.stringify({ signature, authorization: auth })).toString("base64");
}

describe("browser sign callback verification", () => {
  it("accepts a signature over the captured signer, challenge tuple and Arc testnet domain", async () => {
    await expect(verifyBrowserSignature(await signedHeader(), challenge, now)).resolves.toBeUndefined();
  });

  it("rejects a forged signer and alternate chain or Gateway domain", async () => {
    for (const options of [
      { signer: other },
      { chainId: 5042 },
      { verifyingContract: `0x${"55".repeat(20)}` },
    ]) {
      await expect(verifyBrowserSignature(await signedHeader(options), challenge, now)).rejects.toThrow();
    }
  });

  it("rejects changed payee, amount, expiry and original challenge network", async () => {
    for (const options of [
      { to: `0x${"55".repeat(20)}` },
      { value: "9000" },
      { validBefore: String(now + 691501) },
    ]) {
      await expect(verifyBrowserSignature(await signedHeader(options), challenge, now)).rejects.toThrow();
    }
    await expect(verifyBrowserSignature(await signedHeader(), {
      ...challenge, requirements: { ...challenge.requirements, network: "eip155:5042" },
    }, now)).rejects.toThrow();
  });

  it("rejects invalid header shape and tampering while accepting only a signed bytes32 nonce", async () => {
    const good = await signedHeader();
    await expect(verifyBrowserSignature(`${good}!`, challenge, now)).rejects.toThrow();
    const body = JSON.parse(Buffer.from(good, "base64").toString("utf8"));
    body.authorization.nonce = `0x${"66".repeat(32)}`;
    await expect(verifyBrowserSignature(Buffer.from(JSON.stringify(body)).toString("base64"), challenge, now)).rejects.toThrow();
    body.authorization.nonce = "0x1";
    await expect(verifyBrowserSignature(Buffer.from(JSON.stringify(body)).toString("base64"), challenge, now)).rejects.toThrow();
  });

  it("rejects a second nested seller payload even when the outer authorization is valid", async () => {
    const body = JSON.parse(Buffer.from(await signedHeader(), "base64").toString("utf8"));
    body.payload = {
      signature: body.signature,
      authorization: { ...body.authorization, nonce: `0x${"99".repeat(32)}` },
    };
    await expect(verifyBrowserSignature(Buffer.from(JSON.stringify(body)).toString("base64"), challenge, now))
      .rejects.toThrow(/ambiguous/);
  });

  it("leaves nonce admission open: another valid browser-chosen nonce also verifies", async () => {
    await expect(verifyBrowserSignature(await signedHeader({ nonce: `0x${"77".repeat(32)}` }), challenge, now))
      .resolves.toBeUndefined();
  });
});
