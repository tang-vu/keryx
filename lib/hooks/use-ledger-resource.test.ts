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
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
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
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
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

it("defers a section until enabled without making other reads wait", async () => {
  let section: ReturnType<typeof useLedgerResource<number>>;
  function Sections({ enabled }: { enabled: boolean }) {
    const current = useLedgerResource("/api/runs", parse);
    const deferred = useLedgerResource("/api/payments", parse, enabled);
    useEffect(() => { resource = current; section = deferred; }, [current, deferred]);
    return null;
  }
  fetcher.mockImplementation(async url => new Response(url === "/api/runs" ? "42" : "7"));
  await act(async () => root.render(createElement(Sections, { enabled: false })));
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/runs"]);
  expect(resource.data).toBe(42);
  expect(section!.data).toBeNull();
  await act(async () => root.render(createElement(Sections, { enabled: true })));
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/runs", "/api/payments"]);
  expect(section!.data).toBe(7);
});

it("pauses hidden tabs and resumes with one fresh read without overlap", async () => {
  let visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
  fetcher.mockImplementation(async () => new Response("42"));
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(59_999));
  expect(fetcher).toHaveBeenCalledTimes(1);
  visibility = "hidden";
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTimeAsync(180_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  visibility = "visible";
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => finish(new Response("43")));
  expect(resource.data).toBe(43);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fetcher).toHaveBeenCalledTimes(3);
  vi.restoreAllMocks();
});
