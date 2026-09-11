import { afterEach, expect, it, vi } from "vitest";
import { maxUint256 } from "viem";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { estimateWithdrawalIntent, matchWithdrawalEstimate } from "./withdrawal-estimate";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function fixture() {
  const { record } = await creatorWithdrawalFixture(), original = record.request.burnIntent;
  const burnIntent = { ...structuredClone(original), maxBlockHeight: "20000", maxFee: "1" };
  return { original, policy: record.policy, burnIntent, body: { body: [{ burnIntent }], fees: { total: "0.000001" } },
    window: { minimumBlockHeight: "19000", maximumBlockHeight: "21000" }, signal: new AbortController().signal };
}
it("preserves the exact transfer spec and enforces finite expiry and fee bounds", async () => {
  const f = await fixture(); expect(matchWithdrawalEstimate(f.body, f.original, f.policy, f.window)).toEqual(f.burnIntent);
  expect(matchWithdrawalEstimate(f.body.body, f.original, f.policy, f.window)).toEqual(f.burnIntent);
  const compact = structuredClone(f.burnIntent);
  for (const field of ["sourceContract", "destinationContract", "sourceToken", "destinationToken", "sourceDepositor",
    "destinationRecipient", "sourceSigner", "destinationCaller"] as const) compact.spec[field] = `0x${compact.spec[field].slice(-40)}`;
  expect(matchWithdrawalEstimate([{ burnIntent: compact }], f.original, f.policy, f.window)).toEqual(f.burnIntent);
  for (const delta of [{ maxBlockHeight: "18999" }, { maxBlockHeight: "21001" }, { maxBlockHeight: maxUint256.toString() },
    { maxFee: (BigInt(f.policy.maxFeeMicros) + BigInt(1)).toString() }, { spec: { ...f.burnIntent.spec, value: "1" } }])
    expect(() => matchWithdrawalEstimate({ body: [{ burnIntent: { ...f.burnIntent, ...delta } }] }, f.original, f.policy, f.window)).toThrow();
  expect(() => matchWithdrawalEstimate({ body: [f.body.body[0], f.body.body[0]] }, f.original, f.policy, f.window)).toThrow();
});
it("sends only an unsigned spec to the fixed estimate endpoint and snapshots caller terms", async () => {
  const f = await fixture(), expected = structuredClone(f.burnIntent);
  const fetcher = vi.fn(async (url, init) => {
    expect(url).toBe("https://gateway-api-testnet.circle.com/v1/estimate");
    expect(init.redirect).toBe("error"); expect(JSON.parse(init.body)).toEqual([{ spec: f.original.spec }]);
    f.original.spec.value = "1"; f.window.maximumBlockHeight = "1";
    return Response.json(f.body);
  }); vi.stubGlobal("fetch", fetcher);
  expect(await estimateWithdrawalIntent(f.original, f.policy, f.window, f.signal)).toEqual(expected);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bounds stalled responses and never turns an error into signing authority", async () => {
  const f = await fixture(); vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const pending = estimateWithdrawalIntent(f.original, f.policy, f.window, f.signal).then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(10001); expect(await pending).toBe(true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "private vendor detail" }, { status: 500 })));
  await expect(estimateWithdrawalIntent(f.original, f.policy, f.window, f.signal)).rejects.toThrow(/^Withdrawal estimate unavailable; do not sign an unreviewed request$/);
});
