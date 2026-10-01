import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  browserQueryPolicyTypedData,
  verifyBrowserQueryPolicy,
  BROWSER_SIGNING_SERVICE,
  type BrowserQueryPolicy,
} from "./browser-query-policy";
const owner = privateKeyToAccount(generatePrivateKey()),
  signer = privateKeyToAccount(generatePrivateKey());
const policy = (): BrowserQueryPolicy => ({
  protocol: "durable-v2",
  service: BROWSER_SIGNING_SERVICE,
  owner: owner.address,
  signer: signer.address,
  policyId: `0x${"01".repeat(32)}`,
  grantEpoch: crypto.randomUUID(),
  requestNonce: `0x${"02".repeat(32)}`,
  queryId: crypto.randomUUID(),
  questionDigest: `0x${"03".repeat(32)}`,
  queryCeilingMicros: "2",
  lifetimeCeilingMicros: "5",
  jobLimit: 2,
  expiresAt: Date.now() + 60000,
});
it("verifies actual owner EIP712 approval with a domain distinct from payments", async () => {
  const p = policy(),
    signature = await owner.signTypedData(browserQueryPolicyTypedData(p));
  const verified = await verifyBrowserQueryPolicy({ policy: p, signature });
  expect(verified.policy.owner).toBe(owner.address.toLowerCase());
  expect(browserQueryPolicyTypedData(p).domain.name).toBe(
    "KeryxBrowserQueryPolicy"
  );
});
it("keeps normalized namespace across approval identities and grant/query aliases", async () => {
  const first = policy(),
    second = {
      ...first,
      policyId: `0x${"04".repeat(32)}` as const,
      queryId: crypto.randomUUID(),
      grantEpoch: crypto.randomUUID(),
    };
  const a = await verifyBrowserQueryPolicy({
    policy: first,
    signature: await owner.signTypedData(browserQueryPolicyTypedData(first)),
  });
  const b = await verifyBrowserQueryPolicy({
    policy: second,
    signature: await owner.signTypedData(browserQueryPolicyTypedData(second)),
  });
  expect(a.namespace).toBe(b.namespace);
  expect(a.proofDigest).not.toBe(b.proofDigest);
});
it("refuses another signer and modified budget despite valid signature syntax", async () => {
  const p = policy(),
    signature = await signer.signTypedData(browserQueryPolicyTypedData(p));
  await expect(
    verifyBrowserQueryPolicy({ policy: p, signature })
  ).rejects.toThrow();
  const ownerSignature = await owner.signTypedData(
    browserQueryPolicyTypedData(p)
  );
  await expect(
    verifyBrowserQueryPolicy({
      policy: { ...p, queryCeilingMicros: "3" },
      signature: ownerSignature,
    })
  ).rejects.toThrow();
});
it("refuses wrong service or chain domain and caller boolean authority", async () => {
  const p = policy(),
    typed = browserQueryPolicyTypedData(p);
  const signature = await owner.signTypedData({
    ...typed,
    domain: { ...typed.domain, chainId: 1 },
  });
  await expect(
    verifyBrowserQueryPolicy({ policy: p, signature })
  ).rejects.toThrow();
  await expect(
    verifyBrowserQueryPolicy({
      policy: { ...p, service: "https://other.invalid" },
      signature,
    })
  ).rejects.toThrow();
  await expect(
    verifyBrowserQueryPolicy({ policy: p, signature, verified: true })
  ).rejects.toThrow();
});
it("refuses unsafe or fractional micro ceilings before proof recovery", async () => {
  const p = policy(),
    signature = await owner.signTypedData(browserQueryPolicyTypedData(p));
  for (const value of ["1.5", "9007199254740992", "0", "01"])
    await expect(
      verifyBrowserQueryPolicy({
        policy: { ...p, queryCeilingMicros: value },
        signature,
      })
    ).rejects.toThrow();
});
