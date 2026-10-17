// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CircleGoogleWalletButton } from "@/components/keryx/circle-google-wallet";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(), login: vi.fn(), toast: vi.fn(), configured: true, canSign: false,
  identity: undefined as undefined | { address: string }, current: undefined as undefined | { id: string },
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ connector: mocks.current }),
  useConnect: () => ({ connectors: [{ id: "circle-google" }], connectAsync: mocks.connect, isPending: false }),
}));
vi.mock("@/lib/circle-wallet-config", () => ({
  CIRCLE_GOOGLE_CONNECTOR_ID: "circle-google", circleWalletPublicConfigured: () => mocks.configured,
}));
vi.mock("@/lib/circle-wallet-browser", () => ({
  circleWalletIdentity: () => mocks.identity, circleWalletCanSign: () => mocks.canSign,
  startGoogleWalletLogin: mocks.login, resumeGoogleWalletLogin: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.configured = true; mocks.identity = undefined; mocks.current = undefined; mocks.canSign = false;
  mocks.connect.mockResolvedValue(undefined); mocks.login.mockResolvedValue(undefined);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), milliseconds);
    return controller.signal;
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const button = () => container.querySelector("button")!;
async function render(props = {}) { await act(async () => root.render(createElement(CircleGoogleWalletButton, props))); }
async function click() { await act(async () => button().click()); }

it("keeps Google visible and disabled during a 13-second config load, then enables it without connecting", async () => {
  const fetcher = vi.fn(() => new Promise<Response>(resolve => setTimeout(() => resolve(Response.json({ available: true })), 13_000)));
  vi.stubGlobal("fetch", fetcher); await render();
  expect(button().textContent).toContain("Continue with Google"); expect(button().disabled).toBe(true);
  expect(container.querySelector('[role="status"]')!.textContent).toContain("Loading wallet options");
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(button().disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2_999); });
  expect(button().disabled).toBe(false);
  expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.login).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["timeout", "network", "http", "malformed"])("offers explicit GET-only retry after %s, then requires a separate login click", async failure => {
  const fetcher = vi.fn((_url: string, init: RequestInit) => {
    if (fetcher.mock.calls.length > 1) return Promise.resolve(Response.json({ available: true }));
    if (failure === "timeout") return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    if (failure === "network") return Promise.reject(new Error("network failure"));
    return Promise.resolve(failure === "http" ? Response.json({ available: true }, { status: 503 }) : Response.json({ available: "true" }));
  });
  const selected = vi.fn(), connected = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await render({ onSelect: selected, onConnected: connected });
  if (failure === "timeout") await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(container.querySelector('[role="status"]')!.textContent).toContain("Google wallet sign-in could not start");
  expect(button().textContent).toContain("Try again"); expect(button().disabled).toBe(false);
  await click();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(button().textContent).toContain("Continue with Google");
  expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.login).not.toHaveBeenCalled(); expect(selected).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([url, init]) => url === "/api/auth/circle/config" && !init.method)).toBe(true);
  await click(); expect(mocks.connect).toHaveBeenCalledTimes(1); expect(selected).toHaveBeenCalledTimes(1); expect(connected).toHaveBeenCalledTimes(1);
});

it("preserves an explicit disabled configuration and absent public setup", async () => {
  const fetcher = vi.fn(async () => Response.json({ available: false })); vi.stubGlobal("fetch", fetcher);
  await render(); expect(container.textContent).toBe(""); expect(mocks.connect).not.toHaveBeenCalled();
  mocks.configured = false; await render(); expect(fetcher).toHaveBeenCalledTimes(1); expect(container.textContent).toBe("");
});

it("aborts unmount and ignores a late ready response from the old check", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher); await render();
  await act(async () => root.render(null));
  expect(fetcher.mock.calls[0][1].signal!.aborted).toBe(true);
  fetcher.mockResolvedValueOnce(Response.json({ available: false })); await render();
  await act(async () => finish(Response.json({ available: true })));
  expect(container.textContent).toBe(""); expect(mocks.connect).not.toHaveBeenCalled();
});

it("serializes expired-wallet reconnect clicks and retains a visible failure for explicit retry", async () => {
  mocks.identity = { address: `0x${"1".repeat(40)}` }; mocks.current = { id: "circle-google" };
  let fail!: (reason: Error) => void;
  mocks.login.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ available: true })));
  const failed = vi.fn(); await render({ reconnectOnly: true, onConnectionFailed: failed });
  await act(async () => { button().click(); button().click(); });
  expect(mocks.login).toHaveBeenCalledTimes(1); expect(button().disabled).toBe(true);
  await act(async () => fail(new Error("preflight unavailable")));
  expect(button().disabled).toBe(false); expect(failed).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="status"]')!.textContent).toContain("Google wallet sign-in could not start");
  await click(); expect(mocks.login).toHaveBeenCalledTimes(2); expect(mocks.connect).not.toHaveBeenCalled();
});
