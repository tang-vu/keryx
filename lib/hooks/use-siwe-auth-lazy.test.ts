// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiweMessage } from "siwe";
import type { SignInResult, useSiweAuth } from "./use-siwe-auth";

const wallet = `0x${"11".repeat(20)}`;
let account: { address?: string; isConnected: boolean; connector?: { id: string } };
let root: Root, container: HTMLDivElement, useAuth: typeof useSiweAuth, auth: ReturnType<typeof useSiweAuth>;
let release: () => void, rejectLoad: boolean, loads: number, session: { address: string; role: string } | null;
let attempt: Promise<SignInResult> | undefined;
const sign = vi.fn(async () => "fixture-signature");
const prepare = vi.fn((fields: object) => new SiweMessage({
  ...fields, statement: "Sign in to Keryx. Citations are currency.", version: "1",
}).prepareMessage());
const paths = () => vi.mocked(fetch).mock.calls.map(call => String(call[0]));
function Probe() {
  const value = useAuth();
  useLayoutEffect(() => { auth = value; });
  return null;
}
const render = async () => { await act(async () => { root.render(createElement(Probe)); }); };
const start = async () => {
  await act(async () => { attempt = auth.signIn(); void attempt.catch(() => {}); });
  await vi.waitFor(() => expect(loads).toBe(1), { timeout: 2000 });
};
const finish = async () => {
  let result: SignInResult | undefined;
  await act(async () => { release(); result = await attempt; });
  return result;
};

beforeEach(async () => {
  vi.resetModules(); loads = 0; rejectLoad = false; session = null; attempt = undefined;
  account = { address: wallet, isConnected: true, connector: { id: "injected" } };
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.doMock("../auth/browser-sign-in-message", async () => {
    loads++; await gate;
    if (rejectLoad) throw new Error("PRIVATE_CHUNK_DETAIL");
    return { prepareBrowserSignInMessage: prepare };
  });
  vi.doMock("wagmi", () => ({ useAccount: () => account, useSignMessage: () => ({ signMessageAsync: sign }) }));
  vi.doMock("../circle-wallet-browser", () => ({ circleWalletIdentity: () => null, clearCircleWalletIdentity: vi.fn() }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", class { onmessage = null; postMessage() {} close() {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/session") return Response.json({ session });
    if (url === "/api/auth/nonce") return Response.json({ nonce: "0123456789abcdef",
      issuedAt: "2026-10-28T00:00:00.000Z", challengeExpiresAt: "2026-10-28T00:05:00.000Z",
      sessionExpiresAt: "2026-11-04T00:00:00.000Z" });
    if (url === "/api/auth/verify") { session = { address: wallet, role: "asker" }; return Response.json({ ok: true, ...session }); }
    if (url === "/api/auth/signout") { session = null; return Response.json({ ok: true }); }
    throw new Error(`Unexpected fixture IO: ${url}`);
  }));
  useAuth = (await import("./use-siwe-auth")).useSiweAuth;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => { release(); await attempt?.catch(() => {}); root.unmount(); });
  container.remove(); vi.doUnmock("../auth/browser-sign-in-message"); vi.doUnmock("wagmi");
  vi.doUnmock("../circle-wallet-browser"); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("sign-in library loading and intent", () => {
  it("does not load the serializer while restoring the existing session", () => {
    expect(paths()).toEqual(["/api/auth/session"]); expect(loads).toBe(0); expect(sign).not.toHaveBeenCalled();
  });

  it("loads only on sign-in, then requests a fresh challenge and preserves the message/verify flow", async () => {
    await start(); expect(auth.authState).toBe("signing");
    expect(paths()).not.toContain("/api/auth/nonce"); expect(sign).not.toHaveBeenCalled();
    expect((await finish())?.ok).toBe(true);
    expect(prepare).toHaveBeenCalledOnce();
    expect(sign).toHaveBeenCalledWith({ message: prepare.mock.results[0].value });
    expect(paths()).toContain("/api/auth/verify"); expect(auth.authState).toBe("idle");
    const verify = vi.mocked(fetch).mock.calls.find(call => String(call[0]) === "/api/auth/verify")!;
    expect(JSON.parse(verify[1]!.body as string)).toEqual({ message: prepare.mock.results[0].value, signature: "fixture-signature" });
  });

  it("refuses load failure before requesting a challenge or signature and shows a plain retry message", async () => {
    rejectLoad = true; await start();
    await act(async () => { release(); await expect(attempt).rejects.toThrow("Sign-in is unavailable. Refresh the page and try again."); });
    expect(paths()).not.toContain("/api/auth/nonce"); expect(sign).not.toHaveBeenCalled(); expect(auth.authState).toBe("idle");
  });

  it.each(["address", "connector", "connection", "address-away-and-back"])("abandons pending sign-in when %s changes", async change => {
    await start();
    account = change === "connector" ? { ...account, connector: { id: "another-wallet" } }
      : change === "connection" ? { ...account, isConnected: false }
      : { ...account, address: `0x${"22".repeat(20)}` };
    await render();
    if (change === "address-away-and-back") { account = { ...account, address: wallet }; await render(); }
    expect((await finish())?.ok).toBe(false);
    expect(paths()).not.toContain("/api/auth/nonce"); expect(sign).not.toHaveBeenCalled();
  });

  it("abandons pending sign-in when logout starts", async () => {
    await start(); await act(async () => { await auth.signOut(); });
    expect((await finish())?.ok).toBe(false);
    expect(paths()).not.toContain("/api/auth/nonce"); expect(sign).not.toHaveBeenCalled();
  });

  it("suppresses a stale load error after logout", async () => {
    rejectLoad = true; await start(); await act(async () => { await auth.signOut(); });
    expect((await finish())?.ok).toBe(false);
    expect(paths()).not.toContain("/api/auth/nonce"); expect(sign).not.toHaveBeenCalled();
  });

  it("abandons pending sign-in on unmount", async () => {
    await start(); await act(async () => { root.unmount(); }); root = createRoot(container);
    expect((await finish())?.ok).toBe(false);
    expect(paths()).not.toContain("/api/auth/nonce"); expect(sign).not.toHaveBeenCalled();
  });

  it("does not load SIWE for a server-proven Google login", async () => {
    const { CIRCLE_GOOGLE_CONNECTOR_ID } = await import("../circle-wallet-config");
    account = { ...account, connector: { id: CIRCLE_GOOGLE_CONNECTOR_ID } }; session = { address: wallet, role: "asker" };
    await render(); let result: SignInResult | undefined;
    await act(async () => { result = await auth.signIn(); });
    expect(result?.ok).toBe(true); expect(loads).toBe(0); expect(sign).not.toHaveBeenCalled();
    expect(paths()).not.toContain("/api/auth/nonce");
  });
});
