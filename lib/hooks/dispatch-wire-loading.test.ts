// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DispatchWire } from "../../components/keryx/dispatch-wire";

let root: Root, container: HTMLDivElement;
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const payment = { kind: "citation", settled: true, settlementStatus: "settled", amountUsdc: 0.002, sourceName: "Settled creator", network: "eip155:5042", id: "settled" };

it("does not overlap a slow ticker read and aborts it when navigation unmounts the header", async () => {
  fetcher.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(createElement(DispatchWire)));
  await act(async () => vi.advanceTimersByTimeAsync(90_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  const signal = fetcher.mock.calls[0][1]!.signal!;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it("retains only settled positive citation rewards and offers a visible retry after failure", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ payments: [payment,
    { ...payment, sourceName: "Pending creator", settled: false, settlementStatus: "pending" },
    { ...payment, sourceName: "Operating fee", kind: "operating-fee" },
    { ...payment, sourceName: "Zero amount", amountUsdc: 0 }] }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ payments: [] }));
  await act(async () => root.render(createElement(DispatchWire)));
  expect(container.textContent).toContain("Settled creator");
  for (const name of ["Pending creator", "Operating fee", "Zero amount"]) expect(container.textContent).not.toContain(name);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(container.textContent).not.toContain("Settled creator");
  const retry = container.querySelector("button")!; expect(retry).not.toBeNull();
  await act(async () => retry.click());
  expect(fetcher).toHaveBeenCalledTimes(3); expect(container.textContent).toBe("");
});
