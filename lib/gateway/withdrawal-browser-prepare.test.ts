import { afterEach, expect, it, vi } from "vitest";
import { maxUint256 } from "viem";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { createWithdrawalBrowserDraft } from "./withdrawal-browser-journal";
import * as journal from "./withdrawal-browser-journal";
import { matchWithdrawalBrowserPreparation, prepareWithdrawalBrowserDraft } from "./withdrawal-browser-prepare";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function fixture() {
  const f = await creatorWithdrawalFixture({ maxBlockHeight: "11000" }), policy = f.record.policy;
  const draft = createWithdrawalBrowserDraft(f.record.request.burnIntent, policy);
  return { policy, body: { wallet: policy.owner, draft, preparedAt: new Date().toISOString() } };
}

it("uses selected authority and exact amount, rejecting self-consistent but changed server terms", async () => {
  const f = await fixture();
  expect(matchWithdrawalBrowserPreparation(f.policy, f.body, 0)).toEqual(f.body.draft);
  for (const change of [
    { maxFeeMicros: (BigInt(f.policy.maxFeeMicros) + BigInt(1)).toString() },
    { maxValueMicros: "50001" }, { recipient: `0x${"11".repeat(20)}` },
    { gatewayWallet: `0x${"11".repeat(20)}` }, { domain: 1 },
  ]) {
    const body = structuredClone(f.body); Object.assign(body.draft.policy, change);
    expect(() => matchWithdrawalBrowserPreparation(f.policy, body, 0)).toThrow();
  }
  for (const value of ["49999", "50001"]) {
    const body = structuredClone(f.body); body.draft.burnIntent.spec.value = value;
    expect(() => matchWithdrawalBrowserPreparation(f.policy, body, 0)).toThrow();
  }
  expect(() => matchWithdrawalBrowserPreparation(f.policy, { ...f.body, wallet: `0x${"11".repeat(20)}` }, 0)).toThrow();
  expect(() => matchWithdrawalBrowserPreparation(f.policy, { ...f.body, signature: "private" }, 0)).toThrow();
});

it("requires finite expiry, canonical identity and bounded request age without claiming chain freshness", async () => {
  const f = await fixture();
  for (const height of ["0", maxUint256.toString()]) {
    const burn = { ...f.body.draft.burnIntent, maxBlockHeight: height };
    expect(() => matchWithdrawalBrowserPreparation(f.policy, { ...f.body,
      draft: createWithdrawalBrowserDraft(burn, f.policy) }, 0)).toThrow();
  }
  for (const age of [NaN, Infinity, -Infinity, -1, 60001])
    expect(() => matchWithdrawalBrowserPreparation(f.policy, f.body, age)).toThrow();
  expect(matchWithdrawalBrowserPreparation(f.policy, f.body, 60000)).toEqual(f.body.draft);
  expect(() => matchWithdrawalBrowserPreparation(f.policy, { ...f.body, preparedAt: "invalid" }, 0)).toThrow();
  const body = structuredClone(f.body); body.draft.id = `0x${"00".repeat(32)}`;
  expect(() => matchWithdrawalBrowserPreparation(f.policy, body, 0)).toThrow();
});

it.each([-86400000, 86400000])("saves an original despite browser wall skew %s and a wall-clock step", async offset => {
  const f = await fixture(), wall = Date.parse(f.body.preparedAt);
  let elapsed = 100, clock = wall + offset;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const save = vi.spyOn(journal, "reserveWithdrawalBrowserJournal").mockImplementation(async (draft, owner) => ({
    format: "creator-withdrawal-browser-v1", id: draft.id, owner, draft, origin: "created", state: "reserved", createdAt: f.body.preparedAt,
  }));
  vi.stubGlobal("fetch", vi.fn(async () => { elapsed += 20; clock += 2 * offset; return Response.json(f.body); }));
  const saved = await prepareWithdrawalBrowserDraft(f.policy, () => f.policy.owner, new AbortController().signal);
  expect(saved.draft).toEqual(f.body.draft); expect(save).toHaveBeenCalledExactlyOnceWith(f.body.draft, f.policy.owner);
});

it.each([NaN, -1, 60001])("rejects invalid or excessive monotonic response age %s before saving", async age => {
  const f = await fixture(); let elapsed = 100;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const save = vi.spyOn(journal, "reserveWithdrawalBrowserJournal");
  vi.stubGlobal("fetch", vi.fn(async () => { elapsed = 100 + age; return Response.json(f.body); }));
  await expect(prepareWithdrawalBrowserDraft(f.policy, () => f.policy.owner, new AbortController().signal)).rejects.toThrow("Check saved drafts");
  expect(save).not.toHaveBeenCalled();
});

it("rejects completion after request age expires during storage, retaining the attempted original", async () => {
  const f = await fixture(); let elapsed = 100;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const save = vi.spyOn(journal, "reserveWithdrawalBrowserJournal").mockImplementation(async (draft, owner) => {
    elapsed += 60001;
    return { format: "creator-withdrawal-browser-v1", id: draft.id, owner, draft, origin: "created", state: "reserved", createdAt: f.body.preparedAt };
  });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(f.body)));
  await expect(prepareWithdrawalBrowserDraft(f.policy, () => f.policy.owner, new AbortController().signal)).rejects.toThrow("Check saved drafts");
  expect(save).toHaveBeenCalledExactlyOnceWith(f.body.draft, f.policy.owner);
});

it("sends only the amount once, withholding mismatched, oversized and error responses before storage", async () => {
  const f = await fixture(), fetcher = vi.fn(async (url, init) => {
    expect(url).toBe("/api/me/withdrawals/prepare");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error" });
    expect(JSON.parse(init.body)).toEqual({ amountMicros: "50000" });
    return Response.json({ ...f.body, wallet: `0x${"11".repeat(20)}` });
  });
  vi.stubGlobal("fetch", fetcher);
  const run = () => prepareWithdrawalBrowserDraft(f.policy, () => f.policy.owner, new AbortController().signal);
  await expect(run()).rejects.toThrow("Check saved drafts");
  fetcher.mockImplementationOnce(async () => Response.json({ error: "private diagnostic" }, { status: 503 }));
  await expect(run()).rejects.toThrow(/^Withdrawal preparation unavailable\. Check saved drafts before preparing again\.$/);
  fetcher.mockImplementationOnce(async () => Response.json({ ...f.body, padding: "x".repeat(8192) }));
  await expect(run()).rejects.toThrow("Check saved drafts");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("bounds stalled transport and prevents late responses or wallet changes from reaching storage", async () => {
  const f = await fixture(); vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const pending = prepareWithdrawalBrowserDraft(f.policy, () => f.policy.owner, new AbortController().signal).then(() => false, () => true);
  await vi.advanceTimersByTimeAsync(40001); expect(await pending).toBe(true);
  finish(Response.json(f.body)); await vi.advanceTimersByTimeAsync(1);
  let owner = f.policy.owner;
  fetcher.mockImplementationOnce(async () => { owner = `0x${"11".repeat(20)}`; return Response.json(f.body); });
  await expect(prepareWithdrawalBrowserDraft(f.policy, () => owner, new AbortController().signal)).rejects.toThrow("Check saved drafts");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("cancels a stalled body and snapshots the selected amount before asynchronous transport", async () => {
  const f = await fixture(); let body!: ReadableStreamDefaultController;
  const stop = new AbortController();
  const fetcher = vi.fn(async () => {
    f.policy.maxValueMicros = "1";
    return new Response(new ReadableStream({ start(controller) { body = controller; } }));
  });
  vi.stubGlobal("fetch", fetcher);
  const pending = prepareWithdrawalBrowserDraft(f.policy, () => f.policy.owner, stop.signal).then(() => false, () => true);
  await Promise.resolve(); stop.abort(); expect(await pending).toBe(true);
  body.enqueue(new TextEncoder().encode(JSON.stringify(f.body))); body.close();
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ amountMicros: "50000" });
});
