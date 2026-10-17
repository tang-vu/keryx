// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ device: vi.fn(), login: vi.fn(), auth: vi.fn(), execute: vi.fn() }));
vi.mock("./browser-payment-profile", () => ({ browserPaymentProfile: () => ({ networkId: "eip155:5042" }) }));
vi.mock("@circle-fin/w3s-pw-web-sdk", () => ({ W3SSdk: class {
  getDeviceId = sdk.device; performLogin = sdk.login; setAuthentication = sdk.auth; execute = sdk.execute;
  updateConfigs() {}
} }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_CIRCLE_APP_ID", "synthetic-app");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "synthetic-google-client");
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, "", "/connect");
  localStorage.setItem("synthetic-funding-hold", "original-uncertain-0.07-no-hash");
  sdk.device.mockResolvedValue("00000000-0000-4000-8000-000000000001"); sdk.login.mockResolvedValue(undefined);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), milliseconds);
    return controller.signal;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("the actual login preflight tolerates 13 seconds before creating one device challenge and starting OAuth once", async () => {
  const fetcher = vi.fn((url: string) => url.endsWith("config")
    ? new Promise<Response>(resolve => setTimeout(() => resolve(Response.json({ available: true })), 13_000))
    : Promise.resolve(Response.json({ state: "a".repeat(64), deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-key", expiresAt: Date.now() + 60_000 })));
  vi.stubGlobal("fetch", fetcher);
  const browser = await import("./circle-wallet-browser"), login = browser.startGoogleWalletLogin();
  await vi.advanceTimersByTimeAsync(10_001);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(sdk.device).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_999); await login;
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/auth/circle/config", "/api/auth/circle/device"]);
  expect(sdk.device).toHaveBeenCalledTimes(1); expect(sdk.login).toHaveBeenCalledTimes(1);
  expect(sdk.execute).not.toHaveBeenCalled(); expect(browser.circleWalletCanSign()).toBe(false);
  expect(localStorage.getItem("synthetic-funding-hold")).toBe("original-uncertain-0.07-no-hash");
});

it.each(["timeout", "network", "http", "malformed", "disabled"])("failed %s preflight preserves existing identity hints and custody without creating a device or OAuth operation", async failure => {
  const originalHint = JSON.stringify({ address: `0x${"1".repeat(40)}`, walletId: "00000000-0000-4000-8000-000000000001", origin: window.location.origin, network: "eip155:5042" });
  localStorage.setItem("keryx-circle-owner-eip155:5042", originalHint);
  const fetcher = vi.fn((_url: string, init: RequestInit) => {
    if (failure === "timeout") return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    if (failure === "network") return Promise.reject(new Error("synthetic network failure"));
    return Promise.resolve(failure === "http" ? Response.json({ available: true }, { status: 503 })
      : Response.json({ available: failure === "disabled" ? false : "true" }));
  });
  vi.stubGlobal("fetch", fetcher); const browser = await import("./circle-wallet-browser");
  const result = expect(browser.startGoogleWalletLogin()).rejects.toThrow();
  if (failure === "timeout") await vi.advanceTimersByTimeAsync(30_000);
  await result;
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe("/api/auth/circle/config");
  expect(fetcher.mock.calls[0][1].method).toBeUndefined();
  expect(sdk.device).not.toHaveBeenCalled(); expect(sdk.login).not.toHaveBeenCalled(); expect(sdk.auth).not.toHaveBeenCalled(); expect(sdk.execute).not.toHaveBeenCalled();
  expect(localStorage.getItem("keryx-circle-owner-eip155:5042")).toBe(originalHint);
  expect(localStorage.getItem("synthetic-funding-hold")).toBe("original-uncertain-0.07-no-hash");
  expect(sessionStorage.getItem("keryx-circle-google-oauth-v1")).toBeNull(); expect(browser.circleWalletCanSign()).toBe(false);
});
