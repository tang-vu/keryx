// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { AUTH_CHALLENGE_TTL_MS } from "./auth-time-policy";
import { registrationTarget, sourceClaimTarget } from "./registration-return";
const sdkMocks = vi.hoisted(() => ({ execute: vi.fn(), login: vi.fn(), auth: vi.fn(), config: vi.fn(), device: vi.fn(), completeLogin: vi.fn() }));
vi.mock("./browser-payment-profile", () => ({ browserPaymentProfile: () => ({ networkId: "eip155:5042" }) }));
vi.mock("@circle-fin/w3s-pw-web-sdk", () => ({ W3SSdk: class {
  constructor(config: unknown, callback?: (error: { code: number; message: string } | undefined, result: unknown) => void) {
    sdkMocks.config(config);
    if (callback) queueMicrotask(() => sdkMocks.completeLogin(callback));
  }
  updateConfigs(config: unknown, callback?: (error: { code: number; message: string } | undefined, result: unknown) => void) {
    sdkMocks.config(config);
    if (callback) queueMicrotask(() => sdkMocks.completeLogin(callback));
  }
  getDeviceId = sdkMocks.device;
  performLogin = sdkMocks.login;
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
  sdkMocks.completeLogin.mockImplementation(callback => callback(undefined, { userToken: "synthetic-user-token-never-store",
    encryptionKey: "synthetic-encryption-key-never-store", refreshToken: "synthetic-refresh-token-never-store" }));
  sdkMocks.device.mockResolvedValue(walletId);
  sdkMocks.login.mockImplementation(async () => {
    localStorage.setItem("state", "synthetic-oauth-state"); localStorage.setItem("nonce", "synthetic-oauth-nonce");
    localStorage.setItem("socialLoginProvider", "Google");
  });
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

const recoveryQuery = { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" };
it("refuses unsupported native transaction signing before API/SDK calls, retaining identity and custody", async () => {
  pendingReturn(undefined); const fetcher = readyWallet();
  const browser = await import("./circle-wallet-browser"); await browser.resumeGoogleWalletLogin(); fetcher.mockClear();
  const original = localStorage.getItem(IDENTITY);
  await expect(browser.signCircleWallet("transaction", "0x02")).rejects.toMatchObject({ code: 4200 });
  expect(fetcher).not.toHaveBeenCalled(); expect(sdkMocks.execute).not.toHaveBeenCalled();
  expect(localStorage.getItem(IDENTITY)).toBe(original); expect(browser.circleWalletIdentity()?.address).toBe(owner);
});
it("uses only live same-owner credentials for explicit read-only recovery and never persists tokens", async () => {
  pendingReturn(undefined); const fetcher = readyWallet();
  const browser = await import("./circle-wallet-browser"); await browser.resumeGoogleWalletLogin(); fetcher.mockClear();
  fetcher.mockResolvedValueOnce(Response.json({ owner, ...recoveryQuery, transactions: [] }));
  expect((await browser.listCircleWalletRecoveryTransactions(owner, recoveryQuery)).transactions).toEqual([]);
  expect(fetcher.mock.calls[0][0]).toBe("/api/auth/circle/recovery-transactions");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ userToken: "synthetic-user-token-never-store", query: recoveryQuery });
  expect(sdkMocks.execute).not.toHaveBeenCalled();
  expect([...Object.values(localStorage), ...Object.values(sessionStorage)].join(" ")).not.toContain("synthetic-user-token-never-store");
  await expect(browser.listCircleWalletRecoveryTransactions(`0x${"2".repeat(40)}`, recoveryQuery)).rejects.toThrow("expired");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("ignores late history after a wallet change", async () => {
  pendingReturn(undefined); const fetcher = readyWallet();
  const browser = await import("./circle-wallet-browser"); await browser.resumeGoogleWalletLogin(); fetcher.mockClear();
  let finish!: (r: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  const pending = browser.listCircleWalletRecoveryTransactions(owner, recoveryQuery);
  browser.clearCircleWalletIdentity(); finish(Response.json({ owner, ...recoveryQuery, transactions: [] }));
  await expect(pending).rejects.toThrow("changed");
  expect(sdkMocks.execute).not.toHaveBeenCalled();
});
it("does not fetch an aborted recovery query or publish a response aborted in flight", async () => {
  pendingReturn(undefined); const fetcher = readyWallet();
  const browser = await import("./circle-wallet-browser"); await browser.resumeGoogleWalletLogin(); fetcher.mockClear();
  const controller = new AbortController(); controller.abort();
  await expect(browser.listCircleWalletRecoveryTransactions(owner, recoveryQuery, controller.signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  const inFlight = new AbortController();
  fetcher.mockImplementationOnce(async () => { inFlight.abort(); return Response.json({ owner, ...recoveryQuery, transactions: [] }); });
  await expect(browser.listCircleWalletRecoveryTransactions(owner, recoveryQuery, inFlight.signal)).rejects.toThrow();
  expect(sdkMocks.execute).not.toHaveBeenCalled();
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

// R445-P2-GOOGLE-RETURN: source-only additions, UNRUN pending exact ROOT command admission.
const creatorDraft = { url: "https://publisher.example/", rssUrl: "https://publisher.example/feed.xml", name: "Publisher",
  sourceClaimId: "claim_original_445", challengeId: "b".repeat(64), referenceId: "public:publisher", fetchPrice: 0.005,
  chainId: 5042, owner, mode: "wallet-funded" as const, gapId: "gap-original", matchedItemLink: "https://publisher.example/post" };
function pendingReturn(publicReturn: unknown, fields: Record<string, unknown> = {}, hash = "id_token=synthetic-google-token&state=synthetic-oauth-state") {
  sessionStorage.setItem(CONTINUATION, JSON.stringify({ state, deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-key",
    expiresAt: Date.now() + 60_000, origin: window.location.origin, oauthState: "synthetic-oauth-state", oauthNonce: "synthetic-oauth-nonce", publicReturn, ...fields }));
  localStorage.setItem("state", "synthetic-oauth-state"); localStorage.setItem("nonce", "synthetic-oauth-nonce"); localStorage.setItem("socialLoginProvider", "Google");
  history.replaceState(null, "", `/connect#${hash}`);
}
function readyWallet() {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.endsWith("prepare") ? { ready: true } : { address: owner, walletId }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
// These injected SDK callbacks test adapter error containment, not vendor crypto
// or the real SDK nonce guard. The installed-SDK browser fixture covers that guard.
it.each(["nonce-mismatch", "vendor-refusal"])("contains the SDK %s callback between valid public-return controls", async refusal => {
  const target = registrationTarget(creatorDraft), original = JSON.stringify({ nonce: "original-payment-nonce", payTo: owner, capMicro: "5000", hold: "unresolved" });
  sessionStorage.setItem("synthetic-original-payment-authority", original); // Sentinel only, not retained payment evidence.
  for (const phase of ["control-before", "refusal", "control-after"]) {
    vi.resetModules(); localStorage.removeItem(IDENTITY);
    const nonce = phase === "refusal" && refusal === "nonce-mismatch" ? "different-synthetic-nonce" : "synthetic-oauth-nonce";
    const token = `${btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${btoa(JSON.stringify({ nonce }))}.synthetic`;
    pendingReturn({ target, network: "eip155:5042" }, {}, `id_token=${token}&state=synthetic-oauth-state`);
    const fetcher = readyWallet(), authEvent = vi.fn(), before = sdkMocks.completeLogin.mock.calls.length;
    sdkMocks.auth.mockClear(); sdkMocks.execute.mockClear();
    if (phase === "refusal") sdkMocks.completeLogin.mockImplementationOnce(callback => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      expect(hash.get("state")).toBe(localStorage.getItem("state"));
      const claims = JSON.parse(atob(hash.get("id_token")!.split(".")[1]));
      if (refusal === "nonce-mismatch") expect(claims.nonce).not.toBe(localStorage.getItem("nonce"));
      else expect(claims.nonce).toBe(localStorage.getItem("nonce"));
      callback({ code: refusal === "nonce-mismatch" ? 155140 : 155139,
        message: refusal === "nonce-mismatch" ? "Failed to validate the idToken/ accessToken" : "Synthetic vendor token verification refusal" }, undefined);
    });
    window.addEventListener("keryx:auth", authEvent);
    const browser = await import("./circle-wallet-browser");
    try {
      if (phase === "refusal") {
        await expect(browser.resumeGoogleWalletLogin()).rejects.toThrow("Google sign-in could not be verified");
        expect(fetcher).not.toHaveBeenCalled(); expect(authEvent).not.toHaveBeenCalled();
        expect(window.location.search).toBe(""); expect(browser.circleWalletIdentity()).toBeUndefined();
        expect(localStorage.getItem(IDENTITY)).toBeNull(); expect(browser.circleWalletCanSign()).toBe(false);
        await expect(browser.signCircleWallet("message", "0x1234")).rejects.toThrow("expired");
        expect(fetcher).not.toHaveBeenCalled();
        expect(sdkMocks.auth).toHaveBeenCalledTimes(1);
        expect(sdkMocks.auth.mock.calls.every(([auth]) => auth.userToken === "" && auth.encryptionKey === "")).toBe(true);
      } else {
        expect(await browser.resumeGoogleWalletLogin()).toEqual({ address: owner, walletId });
        expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(target);
        expect(authEvent).toHaveBeenCalledTimes(1); expect(browser.circleWalletCanSign()).toBe(true);
        expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/auth/circle/prepare", "/api/auth/circle/session"]);
      }
      expect(sdkMocks.completeLogin.mock.calls.length - before).toBe(1); expect(sdkMocks.execute).not.toHaveBeenCalled();
      expect(window.location.hash).toBe(""); expect(sessionStorage.getItem(CONTINUATION)).toBeNull();
      for (const key of ["state", "nonce", "socialLoginProvider"]) expect(localStorage.getItem(key)).toBeNull();
      expect(sessionStorage.getItem("synthetic-original-payment-authority")).toBe(original);
      const stored = [...Object.values(sessionStorage), ...Object.values(localStorage)].join(" ");
      for (const secret of ["synthetic-user-token-never-store", "synthetic-encryption-key-never-store", "synthetic-refresh-token-never-store", "synthetic-device-key"]) expect(stored).not.toContain(secret);
    } finally { window.removeEventListener("keryx:auth", authEvent); }
  }
});
it.each([registrationTarget(creatorDraft), registrationTarget({ ...creatorDraft, chainId: 5042002 }),
  sourceClaimTarget({ url: creatorDraft.url, rssUrl: creatorDraft.rssUrl, claimId: creatorDraft.sourceClaimId,
    challengeId: creatorDraft.challengeId, referenceId: creatorDraft.referenceId, owner })])(
  "restores exact public draft/proof/price/network before auth consumers at a bare full-page callback and reload: %s", async target => {
    pendingReturn({ target, network: "eip155:5042" });
    const original = JSON.stringify({ nonce: "original-payment-nonce", payTo: owner, capMicro: "5000", hold: "unresolved" });
    sessionStorage.setItem("synthetic-original-payment-authority", original);
    const fetcher = readyWallet(); let observed: string | null = null;
    const listener = () => { observed = new URLSearchParams(window.location.search).get("returnTo"); };
    window.addEventListener("keryx:auth", listener);
    const browser = await import("./circle-wallet-browser");
    try { expect(await browser.resumeGoogleWalletLogin()).toEqual({ address: owner, walletId }); }
    finally { window.removeEventListener("keryx:auth", listener); }
    expect(observed).toBe(target); expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(target);
    expect(window.location.hash).toBe(""); expect(sessionStorage.getItem(CONTINUATION)).toBeNull();
    expect(localStorage.getItem("state")).toBeNull(); expect(localStorage.getItem("nonce")).toBeNull();
    expect(sessionStorage.getItem("synthetic-original-payment-authority")).toBe(original);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/auth/circle/prepare", "/api/auth/circle/session"]);
    expect(sdkMocks.execute).not.toHaveBeenCalled();
    vi.resetModules(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ session: { address: owner } })));
    const reloaded = await import("./circle-wallet-browser");
    expect(await reloaded.restoreCircleWalletIdentity()).toEqual({ address: owner, walletId });
    expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(target); expect(reloaded.circleWalletCanSign()).toBe(false);
  });
it.each([owner, undefined])("captures only validated public navigation on same-owner reconnect, binding a missing owner and keeping the fixed vendor redirect: %s", async initiatingOwner => {
  storedIdentity(); const target = registrationTarget(creatorDraft);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url === "/api/auth/session" ? { session: { address: owner } }
    : url.endsWith("config") ? { available: true } : { state, deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-key", expiresAt: Date.now() + 60_000 })));
  const browser = await import("./circle-wallet-browser"); await browser.restoreCircleWalletIdentity();
  history.replaceState(null, "", `/connect?${new URLSearchParams({ returnTo: registrationTarget({ ...creatorDraft, owner: initiatingOwner }) + "&userToken=never-persist&signature=never-persist&submit=1" })}`);
  await browser.startGoogleWalletLogin();
  const pending = JSON.parse(sessionStorage.getItem(CONTINUATION)!);
  expect(pending.publicReturn).toEqual({ target, network: "eip155:5042" });
  expect(pending.state).toBe(state); expect(pending.oauthState).toBe("synthetic-oauth-state");
  expect(sdkMocks.config).toHaveBeenLastCalledWith(expect.objectContaining({ loginConfigs: expect.objectContaining({ google: expect.objectContaining({ redirectUri: `${window.location.origin}/connect` }) }) }));
  expect(JSON.stringify(pending.publicReturn)).not.toContain("never-persist"); expect(sdkMocks.execute).not.toHaveBeenCalled();
  pendingReturn(pending.publicReturn); readyWallet();
  expect(await browser.resumeGoogleWalletLogin()).toEqual({ address: owner, walletId });
  expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(target);
});
it.each(["https://evil.example/register", "/register?name=" + "x".repeat(6001), "/register?fetchPrice=0.0000001"])(
  "does not store an external, oversized or invalid creator target: %s", async target => {
    history.replaceState(null, "", `/connect?${new URLSearchParams({ returnTo: target })}`);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("config") ? { available: true }
      : { state, deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-key", expiresAt: Date.now() + 60_000 })));
    const browser = await import("./circle-wallet-browser"); await browser.startGoogleWalletLogin();
    expect(JSON.parse(sessionStorage.getItem(CONTINUATION)!)).not.toHaveProperty("publicReturn");
  });
it.each([
  { target: "https://evil.example/register", network: "eip155:5042" },
  { target: "/register?name=" + "x".repeat(6001), network: "eip155:5042" },
  { target: "/register?chainId=1", network: "eip155:5042" },
  { target: registrationTarget({ ...creatorDraft, owner: `0x${"2".repeat(40)}` }), network: "eip155:5042" },
  { target: registrationTarget(creatorDraft), network: "eip155:5042002" },
  { target: 123, network: "eip155:5042" }, null,
])("drops invalid, switched-owner or switched-profile context without changing callback authentication: %j", async context => {
  pendingReturn(context); readyWallet(); const browser = await import("./circle-wallet-browser");
  expect(await browser.resumeGoogleWalletLogin()).toEqual({ address: owner, walletId });
  expect(window.location.search).toBe(""); expect(sessionStorage.getItem(CONTINUATION)).toBeNull(); expect(sdkMocks.execute).not.toHaveBeenCalled();
});
it.each([
  { fields: { expiresAt: Date.now() - 1 }, hash: "id_token=synthetic-google-token&state=synthetic-oauth-state" },
  { fields: { origin: "https://other.example" }, hash: "id_token=synthetic-google-token&state=synthetic-oauth-state" },
  { fields: {}, hash: "id_token=synthetic-google-token&state=wrong-state" },
  { fields: {}, hash: "error=access_denied&state=synthetic-oauth-state" },
])("never recovers context from expired, cross-origin, mismatched or cancelled OAuth: %j", async ({ fields, hash }) => {
  pendingReturn({ target: registrationTarget(creatorDraft), network: "eip155:5042" }, fields, hash);
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const browser = await import("./circle-wallet-browser");
  await expect(browser.resumeGoogleWalletLogin()).rejects.toThrow();
  expect(window.location.search).toBe(""); expect(window.location.hash).toBe(""); expect(sessionStorage.getItem(CONTINUATION)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled(); expect(browser.circleWalletIdentity()).toBeUndefined(); expect(sdkMocks.execute).not.toHaveBeenCalled();
});
it("does not publish return context when the server cannot verify the wallet session", async () => {
  pendingReturn({ target: registrationTarget(creatorDraft), network: "eip155:5042" });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("prepare") ? Response.json({ ready: true }) : Response.json({ error: "synthetic session refusal" }, { status: 401 })));
  const browser = await import("./circle-wallet-browser"); await expect(browser.resumeGoogleWalletLogin()).rejects.toThrow("synthetic session refusal");
  expect(window.location.search).toBe(""); expect(sessionStorage.getItem(CONTINUATION)).toBeNull();
  expect(browser.circleWalletIdentity()).toBeUndefined(); expect(browser.circleWalletCanSign()).toBe(false); expect(sdkMocks.execute).not.toHaveBeenCalled();
});
it.each(["expired during verification", "identity cleared during verification"])("discards public context if %s without adding authentication decisions", async reason => {
  const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
  pendingReturn({ target: registrationTarget(creatorDraft), network: "eip155:5042" });
  const browser = await import("./circle-wallet-browser");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("prepare")) return Response.json({ ready: true });
    if (reason === "expired during verification") clock.mockReturnValue(now + 61_000);
    else browser.clearCircleWalletIdentity();
    return Response.json({ address: owner, walletId });
  }));
  expect(await browser.resumeGoogleWalletLogin()).toEqual({ address: owner, walletId });
  expect(window.location.search).toBe(""); expect(sessionStorage.getItem(CONTINUATION)).toBeNull(); expect(sdkMocks.execute).not.toHaveBeenCalled();
});
