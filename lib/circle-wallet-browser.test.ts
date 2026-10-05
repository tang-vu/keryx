// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { AUTH_CHALLENGE_TTL_MS } from "./auth-time-policy";
const sdkMocks = vi.hoisted(() => ({ execute: vi.fn(), login: vi.fn(), auth: vi.fn() }));
vi.mock("./browser-payment-profile", () => ({ browserPaymentProfile: () => ({ networkId: "eip155:5042" }) }));
vi.mock("@circle-fin/w3s-pw-web-sdk", () => ({ W3SSdk: class {
  constructor(_config: unknown, callback?: (error: undefined, result: unknown) => void) {
    if (callback) queueMicrotask(() => callback(undefined, { userToken: "synthetic-user-token-never-store", encryptionKey: "synthetic-encryption-key-never-store", refreshToken: "synthetic-refresh-token-never-store" }));
  }
  setAuthentication = sdkMocks.auth;
  execute = sdkMocks.execute;
} }));
const state = "a".repeat(64), walletId = "00000000-0000-4000-8000-000000000001", owner = `0x${"1".repeat(40)}`;
const IDENTITY = "keryx-circle-owner-eip155:5042", CONTINUATION = "keryx-circle-google-oauth-v1";
function storedIdentity(fields: Record<string, unknown> = {}) {
  localStorage.setItem(IDENTITY, JSON.stringify({ address: owner, walletId, network: "eip155:5042", origin: window.location.origin, ...fields }));
}
beforeEach(() => {
  vi.resetModules(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs();
  sessionStorage.clear(); localStorage.clear(); history.replaceState(null, "", "/connect");
  vi.stubEnv("NEXT_PUBLIC_CIRCLE_APP_ID", "synthetic-app"); vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "synthetic-google-client");
  vi.stubGlobal("BroadcastChannel", class { postMessage() {} close() {} });
});
it("restores only public Circle identity after a live same-wallet session check, with no new Google login", async () => {
  storedIdentity(); const fetcher = vi.fn(async () => Response.json({ session: { address: owner, role: "asker" } })); vi.stubGlobal("fetch", fetcher);
  const browser = await import("./circle-wallet-browser");
  expect(await browser.restoreCircleWalletIdentity()).toEqual({ address: owner, walletId });
  expect(fetcher).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({ cache: "no-store" }));
  expect(browser.circleWalletCanSign()).toBe(false);
  await expect(browser.signCircleWallet("message", "0x1234")).rejects.toThrow("expired");
  expect(fetcher).toHaveBeenCalledTimes(1); expect(sdkMocks.auth).not.toHaveBeenCalled();
});
it.each([{ origin: "https://attacker.invalid" }, { network: "eip155:5042002" }, { address: "invalid" }])(
  "does not publish a tampered public identity hint", async fields => {
    storedIdentity(fields); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const browser = await import("./circle-wallet-browser");
    expect(await browser.restoreCircleWalletIdentity()).toBeUndefined(); expect(fetcher).not.toHaveBeenCalled();
  });
it.each([null, { address: `0x${"2".repeat(40)}` }])("does not restore a signed-out/different account", async session => {
  storedIdentity(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ session })));
  const browser = await import("./circle-wallet-browser");
  expect(await browser.restoreCircleWalletIdentity()).toBeUndefined(); expect(browser.circleWalletIdentity()).toBeUndefined();
});
it("cannot republish identity after logout races an in-flight restore", async () => {
  storedIdentity(); let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const browser = await import("./circle-wallet-browser"); const pending = browser.restoreCircleWalletIdentity();
  browser.clearCircleWalletIdentity(); finish(Response.json({ session: { address: owner } }));
  expect(await pending).toBeUndefined(); expect(browser.circleWalletIdentity()).toBeUndefined(); expect(localStorage.getItem(IDENTITY)).toBeNull();
});
it("completes OAuth with memory-only credentials, a server-verified owner, and exact owned cleanup", async () => {
  const nonce = "synthetic-google-nonce";
  sessionStorage.setItem(CONTINUATION, JSON.stringify({ state, deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-key",
    expiresAt: Date.now() + 60_000, origin: window.location.origin, oauthState: "synthetic-oauth-state", oauthNonce: nonce }));
  localStorage.setItem("state", "synthetic-oauth-state"); localStorage.setItem("nonce", nonce); localStorage.setItem("socialLoginProvider", "Google");
  localStorage.setItem("unrelated-user-preference", "retained"); history.replaceState(null, "", "/connect#id_token=synthetic-google-token&state=synthetic-oauth-state");
  const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith("prepare") ? { ready: true } : { ok: true, address: owner, walletId }));
  vi.stubGlobal("fetch", fetcher);
  const browser = await import("./circle-wallet-browser");
  expect(await browser.resumeGoogleWalletLogin()).toEqual({ address: owner, walletId });
  expect(browser.circleWalletCanSign()).toBe(true); expect(window.location.hash).toBe("");
  expect(sessionStorage.getItem(CONTINUATION)).toBeNull(); expect(localStorage.getItem("state")).toBeNull();
  expect(localStorage.getItem("unrelated-user-preference")).toBe("retained");
  const persisted = [...Object.values(sessionStorage), ...Object.values(localStorage)].join(" ");
  for (const secret of ["synthetic-user-token-never-store", "synthetic-encryption-key-never-store", "synthetic-refresh-token-never-store", "synthetic-device-key"]) expect(persisted).not.toContain(secret);
  // A fresh page can recover identity for a retained budget, but has no owner signing credentials.
  vi.resetModules(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ session: { address: owner } })));
  const reloaded = await import("./circle-wallet-browser");
  expect(await reloaded.restoreCircleWalletIdentity()).toEqual({ address: owner, walletId }); expect(reloaded.circleWalletCanSign()).toBe(false);
});
it("does not delete another tab's newer generic SDK state while cleaning up an expired flow", async () => {
  sessionStorage.setItem(CONTINUATION, JSON.stringify({ state, deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-key",
    expiresAt: Date.now() - 1, origin: window.location.origin, oauthState: "old-state", oauthNonce: "old-nonce" }));
  localStorage.setItem("state", "new-state"); localStorage.setItem("nonce", "new-nonce"); localStorage.setItem("socialLoginProvider", "Google");
  history.replaceState(null, "", "/connect#id_token=synthetic-google-token&state=old-state");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const browser = await import("./circle-wallet-browser");
  await expect(browser.resumeGoogleWalletLogin()).rejects.toThrow("expired");
  expect(fetcher).not.toHaveBeenCalled(); expect(localStorage.getItem("state")).toBe("new-state"); expect(localStorage.getItem("nonce")).toBe("new-nonce");
});
it("refuses continuation beyond the shared five-minute login window before any wallet operation", async () => {
  sessionStorage.setItem(CONTINUATION, JSON.stringify({ state, deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-key",
    expiresAt: Date.now() + AUTH_CHALLENGE_TTL_MS + 60_000, origin: window.location.origin, oauthState: "synthetic-oauth-state", oauthNonce: "synthetic-oauth-nonce" }));
  localStorage.setItem("state", "synthetic-oauth-state"); localStorage.setItem("nonce", "synthetic-oauth-nonce");
  localStorage.setItem("socialLoginProvider", "Google");
  history.replaceState(null, "", "/connect#id_token=synthetic-google-token&state=synthetic-oauth-state");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const browser = await import("./circle-wallet-browser");
  await expect(browser.resumeGoogleWalletLogin()).rejects.toThrow("expired");
  expect(fetcher).not.toHaveBeenCalled(); expect(sdkMocks.execute).not.toHaveBeenCalled();
  expect(browser.circleWalletIdentity()).toBeUndefined(); expect(window.location.hash).toBe("");
  expect(sessionStorage.getItem(CONTINUATION)).toBeNull(); expect(localStorage.getItem("state")).toBeNull();
  expect(localStorage.getItem("nonce")).toBeNull(); expect(localStorage.getItem("socialLoginProvider")).toBeNull();
});
