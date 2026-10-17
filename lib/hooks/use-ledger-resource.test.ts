// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLedgerResource } from "./use-ledger-resource";

const parse = (value: unknown) => Number(value);
let root: Root, container: HTMLDivElement;
let resource: ReturnType<typeof useLedgerResource<number>>;
const fetcher = vi.fn<typeof fetch>();
function Probe() {
  const current = useLedgerResource("/api/metrics", parse);
  useEffect(() => { resource = current; }, [current]);
  return null;
}
async function mount() { await act(async () => root.render(createElement(Probe))); }
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("signals a manual retry immediately and waits for its result before polling again", async () => {
  let finish!: (response: Response) => void;
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue(new Response("43"));
  await mount();
  expect(resource.status).toBe("error");
  await act(async () => resource.retry());
  expect(resource.retrying).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(10_100));
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => finish(new Response("42")));
  expect(resource).toMatchObject({ status: "ready", data: 42, retrying: false });
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(resource.data).toBe(43);
});

it("keeps the original observation through a failed retry and allows a later successful retry", async () => {
  let finish!: (response: Response) => void;
  fetcher.mockResolvedValueOnce(new Response("42"))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(new Response("43"));
  await mount();
  const observedAt = resource.observedAt;
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  await act(async () => resource.retry());
  expect(resource).toMatchObject({ status: "error", data: 42, observedAt, retrying: true });
  await act(async () => finish(new Response(null, { status: 503 })));
  expect(resource).toMatchObject({ status: "error", data: 42, observedAt, retrying: false });
  await act(async () => resource.retry());
  expect(resource).toMatchObject({ status: "ready", data: 43, retrying: false });
});

it("aborts an outstanding read on retry and ignores its late result", async () => {
  let finishOld!: (response: Response) => void, finishRetry!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishRetry = resolve; }));
  await mount();
  const oldSignal = fetcher.mock.calls[0][1]!.signal!;
  await act(async () => resource.retry());
  expect(oldSignal.aborted).toBe(true);
  await act(async () => finishOld(new Response("1")));
  expect(resource).toMatchObject({ data: null, retrying: true });
  await act(async () => finishRetry(new Response("42")));
  expect(resource).toMatchObject({ status: "ready", data: 42, retrying: false });
});
