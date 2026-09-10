import { expect, it } from "vitest";
import { privateWorkerConfigurationId } from "./private-worker-configuration";

const policy = {
  merchants: { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` },
  treasury: { signer: `0x${"ef".repeat(20)}`, capacityMicros: "50000" }, serviceFeeMicros: "20000",
  disclosure: { modelId: "deepseek-flash", provider: "deepseek" as const, wireModel: "deepseek-v4-flash",
    endpoint: "https://synthetic.example/v1/chat/completions", fallback: "local-heuristic" as const, redirects: "prohibited" as const },
};

it("binds operating terms while canonicalizing field order and address case", () => {
  const id = privateWorkerConfigurationId(policy);
  expect(id).toMatch(/^[a-f0-9]{64}$/);
  const reordered = { ...policy, merchants: { ...policy.merchants, privatePayee: `0x${"AB".repeat(20)}` },
    disclosure: Object.fromEntries(Object.entries(policy.disclosure).reverse()) as typeof policy.disclosure };
  expect(privateWorkerConfigurationId(reordered)).toBe(id);
  const changed = [
    { ...policy, merchants: { ...policy.merchants, privatePayee: `0x${"12".repeat(20)}` } },
    { ...policy, merchants: { ...policy.merchants, publicResearchPayee: `0x${"12".repeat(20)}` } },
    { ...policy, treasury: { ...policy.treasury, signer: `0x${"12".repeat(20)}` } },
    { ...policy, treasury: { ...policy.treasury, capacityMicros: "60000" } },
    { ...policy, serviceFeeMicros: "30000" },
    { ...policy, disclosure: { ...policy.disclosure, modelId: "different-model" } },
    { ...policy, disclosure: { ...policy.disclosure, wireModel: "different-wire-model" } },
    { ...policy, disclosure: { ...policy.disclosure, provider: "mimo" as const } },
    { ...policy, disclosure: { ...policy.disclosure, endpoint: "https://different.example/v1/chat/completions" } },
  ];
  for (const value of changed) expect(privateWorkerConfigurationId(value)).not.toBe(id);
});

it("excludes credentials from the policy digest and rejects malformed public terms", () => {
  const first = { ...policy, provider: { apiKey: "synthetic-first-secret" } };
  const second = { ...policy, provider: { apiKey: "synthetic-second-secret" } };
  expect(privateWorkerConfigurationId(first)).toBe(privateWorkerConfigurationId(second));
  expect(() => privateWorkerConfigurationId({ ...policy, serviceFeeMicros: "-1" })).toThrow();
  expect(() => privateWorkerConfigurationId({ ...policy, disclosure: { ...policy.disclosure,
    endpoint: "https://synthetic.example/v1/chat/completions?key=synthetic" } })).toThrow();
});
