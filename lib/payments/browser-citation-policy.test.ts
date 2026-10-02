import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  browserQueryPolicyTypedData,
  verifyBrowserQueryPolicy,
  type BrowserQueryPolicy,
} from "./browser-query-policy";
import {
  browserCitationPolicyTypedData,
  computeBrowserCitationPoolMicros,
  verifyBrowserCitationPolicy,
  unsealVerifiedBrowserCitationPolicy,
  type BrowserCitationPolicy,
  type VerifiedBrowserCitationPolicy,
} from "./browser-citation-policy";

const owner = privateKeyToAccount(generatePrivateKey());
const signer = privateKeyToAccount(generatePrivateKey());
const hash = (byte: string) => `0x${byte.repeat(64)}` as const;
const trusted = {
  allocationAlgorithmDigest: hash("1"),
  evidenceAlgorithmDigest: hash("2"),
  trustedIssuerDigest: hash("3"),
  authorityPolicyDigest: hash("4"),
};
async function fixture() {
  const now = Date.now();
  const query: BrowserQueryPolicy = {
    protocol: "durable-v2",
    service: "https://keryx.cc",
    owner: owner.address,
    signer: signer.address,
    policyId: hash("5"),
    grantEpoch: crypto.randomUUID(),
    requestNonce: hash("6"),
    queryId: crypto.randomUUID(),
    questionDigest: hash("7"),
    queryCeilingMicros: "100",
    lifetimeCeilingMicros: "1000",
    jobLimit: 10,
    expiresAt: now + 60000,
  };
  const queryProof = {
    policy: query,
    signature: await owner.signTypedData(browserQueryPolicyTypedData(query)),
  };
  const verified = await verifyBrowserQueryPolicy(queryProof);
  const policy: BrowserCitationPolicy = {
    version: "citation-policy-v1",
    service: query.service,
    owner: owner.address,
    signer: signer.address,
    namespace: verified.namespace as `0x${string}`,
    queryId: query.queryId,
    queryPolicyProofDigest: verified.proofDigest as `0x${string}`,
    questionDigest: query.questionDigest as `0x${string}`,
    grantEpoch: query.grantEpoch,
    supplementNonce: hash("8"),
    runBudgetMicros: "99",
    poolNumerator: "1",
    poolDenominator: "2",
    poolRounding: "nearest-half-up",
    maximumPoolMicros: "50",
    ...trusted,
    expiresAt: now + 30000,
  };
  const sign = async (p = policy) => ({
    policy: p,
    signature: await owner.signTypedData(browserCitationPolicyTypedData(p)),
  });
  return { now, queryProof, policy, sign };
}

it("requires actual separate owner proof and preserves the original query signature", async () => {
  const f = await fixture();
  const original = JSON.stringify(f.queryProof);
  const token = await verifyBrowserCitationPolicy(
    await f.sign(),
    f.queryProof,
    trusted,
    () => f.now
  );
  const retained = unsealVerifiedBrowserCitationPolicy(token, f.now);
  expect(retained.poolMicros).toBe("50");
  expect(Object.isFrozen(retained.policy)).toBe(true);
  expect(JSON.stringify(f.queryProof)).toBe(original);
  expect(browserCitationPolicyTypedData(f.policy).domain.name).toBe(
    "KeryxBrowserCitationPolicy"
  );
  expect(
    browserCitationPolicyTypedData(f.policy)
      .types.CitationPolicy.map((field) => `${field.name}:${field.type}`)
      .join(",")
  ).toBe(
    "version:string,service:string,owner:address,signer:address,namespace:bytes32,queryId:string,queryPolicyProofDigest:bytes32,questionDigest:bytes32,grantEpoch:string,supplementNonce:bytes32,runBudgetMicros:uint256,poolNumerator:uint256,poolDenominator:uint256,poolRounding:string,maximumPoolMicros:uint256,allocationAlgorithmDigest:bytes32,evidenceAlgorithmDigest:bytes32,trustedIssuerDigest:bytes32,authorityPolicyDigest:bytes32,expiresAt:uint256"
  );
  expect(browserCitationPolicyTypedData(f.policy).domain.version).toBe("1");
  expect(browserCitationPolicyTypedData(f.policy).domain.chainId).toBe(5042002);
  expect(() =>
    unsealVerifiedBrowserCitationPolicy(
      {} as VerifiedBrowserCitationPolicy,
      f.now
    )
  ).toThrow();
});

it("uses exact half-up arithmetic including zero and maximum-safe multiplication", async () => {
  const { policy } = await fixture();
  for (const [budget, numerator, denominator, expected] of [
    ["1", "1", "2", "1"],
    ["3", "1", "2", "2"],
    ["2", "1", "3", "1"],
    ["3", "0", "1", "0"],
    [
      "9007199254740991",
      "9007199254740991",
      "9007199254740991",
      "9007199254740991",
    ],
  ]) {
    expect(
      computeBrowserCitationPoolMicros({
        ...policy,
        runBudgetMicros: budget,
        poolNumerator: numerator,
        poolDenominator: denominator,
        maximumPoolMicros: "9007199254740991",
      })
    ).toBe(expected);
  }
  expect(() =>
    computeBrowserCitationPoolMicros({ ...policy, maximumPoolMicros: "49" })
  ).toThrow();
  for (const patch of [
    { poolDenominator: "0" },
    { poolNumerator: "3" },
    { runBudgetMicros: "01" },
    { runBudgetMicros: "1.5" },
    { runBudgetMicros: "9007199254740992" },
  ]) {
    expect(() =>
      computeBrowserCitationPoolMicros({ ...policy, ...patch })
    ).toThrow();
  }
});

it("refuses wrong signing key and foreign EIP712 domains", async () => {
  const f = await fixture();
  const typed = browserCitationPolicyTypedData(f.policy);
  for (const signature of [
    await signer.signTypedData(typed),
    await owner.signTypedData({
      ...typed,
      domain: { ...typed.domain, chainId: 1 },
    }),
    await owner.signTypedData({
      ...typed,
      domain: { ...typed.domain, name: "GatewayWalletBatched" },
    }),
  ]) {
    await expect(
      verifyBrowserCitationPolicy(
        { policy: f.policy, signature },
        f.queryProof,
        trusted,
        () => f.now
      )
    ).rejects.toThrow();
  }
});

it("refuses every changed query binding even when separately signed by the owner", async () => {
  const f = await fixture();
  for (const patch of [
    { owner: signer.address },
    { signer: owner.address },
    { namespace: hash("9") },
    { queryId: crypto.randomUUID() },
    { grantEpoch: crypto.randomUUID() },
    { questionDigest: hash("9") },
    { queryPolicyProofDigest: hash("9") },
    { runBudgetMicros: "101" },
    { expiresAt: f.queryProof.policy.expiresAt + 1 },
  ]) {
    await expect(
      verifyBrowserCitationPolicy(
        await f.sign({ ...f.policy, ...patch }),
        f.queryProof,
        trusted,
        () => f.now
      )
    ).rejects.toThrow();
  }
  const proof = await f.sign();
  await expect(
    verifyBrowserCitationPolicy(
      { ...proof, policy: { ...f.policy, supplementNonce: hash("9") } },
      f.queryProof,
      trusted,
      () => f.now
    )
  ).rejects.toThrow();
  await expect(
    verifyBrowserCitationPolicy(
      await f.sign({ ...f.policy, maximumPoolMicros: "49" }),
      f.queryProof,
      trusted,
      () => f.now
    )
  ).rejects.toThrow();
  await expect(
    verifyBrowserCitationPolicy(
      proof,
      {
        ...f.queryProof,
        policy: { ...f.queryProof.policy, queryCeilingMicros: "99" },
      },
      trusted,
      () => f.now
    )
  ).rejects.toThrow();
  await expect(
    verifyBrowserCitationPolicy(
      proof,
      { ...f.queryProof, namespace: f.policy.namespace, verified: true },
      trusted,
      () => f.now
    )
  ).rejects.toThrow();
});

it("requires exact explicit trusted algorithms and issuer, bounded strict fields and valid integer syntax", async () => {
  const f = await fixture();
  const proof = await f.sign();
  for (const field of Object.keys(trusted) as (keyof typeof trusted)[]) {
    await expect(
      verifyBrowserCitationPolicy(
        await f.sign({ ...f.policy, [field]: hash("9") }),
        f.queryProof,
        trusted,
        () => f.now
      )
    ).rejects.toThrow();
  }
  for (const invalid of [
    { ...proof, verified: true },
    { ...proof, policy: { ...f.policy, extra: "x" } },
    { ...proof, policy: { ...f.policy, supplementNonce: "x".repeat(5000) } },
    { ...proof, policy: { ...f.policy, runBudgetMicros: 99 } },
    { ...proof, policy: { ...f.policy, service: "https://foreign.invalid" } },
  ]) {
    await expect(
      verifyBrowserCitationPolicy(invalid, f.queryProof, trusted, () => f.now)
    ).rejects.toThrow();
  }
  await expect(
    verifyBrowserCitationPolicy(
      proof,
      f.queryProof,
      {} as typeof trusted,
      () => f.now
    )
  ).rejects.toThrow();
});

it("captures proof, query and trusted policy before awaits and refuses post-recovery expiry or backwards UTC", async () => {
  const f = await fixture();
  const proof = await f.sign();
  const expected = { ...trusted };
  const pending = verifyBrowserCitationPolicy(
    proof,
    f.queryProof,
    expected,
    () => f.now
  );
  proof.policy.maximumPoolMicros = "0";
  f.queryProof.policy.queryCeilingMicros = "1";
  expected.trustedIssuerDigest = hash("9");
  expect(
    unsealVerifiedBrowserCitationPolicy(await pending, f.now).poolMicros
  ).toBe("50");
  const fresh = await fixture();
  for (const finalTime of [fresh.policy.expiresAt, fresh.now - 1]) {
    let calls = 0;
    await expect(
      verifyBrowserCitationPolicy(
        await fresh.sign(),
        fresh.queryProof,
        trusted,
        () => (calls++ === 0 ? fresh.now : finalTime)
      )
    ).rejects.toThrow();
  }
  await expect(
    verifyBrowserCitationPolicy(
      await fresh.sign(),
      fresh.queryProof,
      trusted,
      () => fresh.policy.expiresAt
    )
  ).rejects.toThrow();
  const token = await verifyBrowserCitationPolicy(
    await fresh.sign(),
    fresh.queryProof,
    trusted,
    () => fresh.now
  );
  expect(() =>
    unsealVerifiedBrowserCitationPolicy(token, fresh.policy.expiresAt)
  ).toThrow();
  expect(() =>
    unsealVerifiedBrowserCitationPolicy(token, fresh.now - 1)
  ).toThrow();
});
