// @vitest-environment jsdom
// Authored regression source only. Not imported, compiled, mounted or executed here.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_ACCOUNT_FRAGMENT_SLOT, chatAccountFragmentBootstrap, takeChatAccountFragment } from "./fragment-intake";
import { useSiweAuth } from "../hooks/use-siwe-auth";
import { notifyBrowserAuthChanged } from "../browser-auth-notice";
import { ChatAccountLinks } from "../../components/keryx/chat-account-links";

// Only the external wallet adapter is synthetic. The canonical auth hook and its
// actual mount/session-fetch body are imported intact, never replaced or mocked.
vi.mock("wagmi", () => ({ useAccount: () => ({ isConnected: false }), useSignMessage: () => ({}) }));
const token = "a".repeat(64), slot = Symbol.for(CHAT_ACCOUNT_FRAGMENT_SLOT);
const executeBootstrap = () => window.eval(chatAccountFragmentBootstrap);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Reflect.deleteProperty(window, slot);
  window.history.replaceState(null, "", `/me/chat-accounts#token=${token}`);
});
afterEach(() => {
  // Also releases the bootstrap's transient listeners if a test did not take it.
  const take = Reflect.get(window, slot); if (typeof take === "function") take();
  Reflect.deleteProperty(window, slot); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
describe("initial chat document fragment bootstrap (UNRUN)", () => {
  it("scrubs before the actual canonical hook mount fetch, then transfers only once to the page consumer", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      expect(location.hash).toBe(""); expect(location.search).toBe("");
      calls.push(String(input)); return Response.json({ session: null });
    }));
    executeBootstrap();
    const container = document.createElement("div"), root = createRoot(container);
    function CanonicalConsumer() { useSiweAuth(); return null; }
    try {
      await act(async () => { root.render(createElement(CanonicalConsumer)); });
      expect(calls).toContain("/api/auth/session");
      expect(takeChatAccountFragment()).toEqual({ token, pendingLogouts: [] });
      expect(takeChatAccountFragment()).toEqual({ token: null, pendingLogouts: [] });
    } finally { await act(async () => root.unmount()); }
  });
  it.each(["nonce=unknown", "token=unknown", `token=${token}&token=${token}`, `token=${token}&nonce=unknown`,
    `token=${token.toUpperCase()}`, `token=%61${"a".repeat(63)}`, `token=${token}&`, "unknown"])
  ("strictly rejects and still scrubs the entire fragment: %s", fragment => {
    window.history.replaceState(null, "", `/me/chat-accounts#${fragment}`); executeBootstrap();
    expect(location.hash).toBe(""); expect(takeChatAccountFragment().token).toBeNull();
  });
  it("never obtains a credential from query, props, DOM or browser storage", () => {
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    window.history.replaceState(null, "", `/me/chat-accounts?token=${token}#nonce=unknown`);
    executeBootstrap(); expect(location.search).toBe(""); expect(location.hash).toBe("");
    expect(takeChatAccountFragment().token).toBeNull(); expect(localSet).not.toHaveBeenCalled();
    expect(document.documentElement.outerHTML).not.toContain(token);
    expect(chatAccountFragmentBootstrap).not.toContain(token);
    expect(chatAccountFragmentBootstrap).not.toMatch(/localStorage|sessionStorage|\.fetch\(|XMLHttpRequest/);
  });
  it("rejects query plus otherwise valid fragment as well, scrubbing both", () => {
    window.history.replaceState(null, "", `/me/chat-accounts?nonce=unknown#token=${token}`); executeBootstrap();
    expect(location.hash).toBe(""); expect(location.search).toBe(""); expect(takeChatAccountFragment().token).toBeNull();
  });
  it("forgets on departure before the page mounts, and cannot re-intake in the same document", () => {
    executeBootstrap(); window.dispatchEvent(new Event("pagehide"));
    expect(takeChatAccountFragment().token).toBeNull();
    window.history.replaceState(null, "", `/me/chat-accounts#token=${token}`); executeBootstrap();
    expect(location.hash).toBe(""); expect(takeChatAccountFragment().token).toBeNull();
  });
  it("carries a canonical pending revocation before mount as a privacy hint, without retaining the token", () => {
    executeBootstrap(); window.dispatchEvent(new CustomEvent("keryx:auth", { detail: {
      type: "logout", source: "canonical", sequence: 1, pending: true, confirmed: false,
    } }));
    expect(takeChatAccountFragment()).toEqual({ token: null, pendingLogouts: ["canonical"] });
  });
  it("does nothing on any other route and refuses unsupported late intake without the initial bootstrap", () => {
    window.history.replaceState(null, "", `/connect#token=${token}`); executeBootstrap();
    expect(location.hash).toBe(`#token=${token}`); expect(Reflect.has(window, slot)).toBe(false);
    window.history.replaceState(null, "", `/me/chat-accounts#token=${token}`);
    expect(takeChatAccountFragment().token).toBeNull(); expect(location.hash).toBe("");
  });
  it("uses a fixed root beforeInteractive slot, without adding request-dependent layout data", () => {
    const layout = readFileSync(`${process.cwd()}/app/layout.tsx`, "utf8");
    expect(layout).toContain('id="keryx-chat-account-fragment" strategy="beforeInteractive"');
    expect(layout).toContain("{chatAccountFragmentBootstrap}");
    expect(layout).not.toMatch(/\b(?:await headers|await cookies|takeChatAccountFragment)\(/);
  });
  it.each([true, false])("cooperates with the actual canonical signOut publisher through pending and terminal confirmed=%s", async confirmed => {
    const account = { accountId: `acct_${"b".repeat(64)}`, revision: 1 };
    const recipient = { platform: "slack", scope: "TPRIVATE", userId: "UPRIVATE", channel: "DPRIVATE" };
    let resolveBody!: (value: unknown) => void, resolveSignout!: (value: Response) => void;
    const oldBody = new Promise<unknown>(resolve => { resolveBody = resolve; });
    const signout = new Promise<Response>(resolve => { resolveSignout = resolve; });
    let hold = false, listStatus = 200, listReads = 0, previews = 0, sessionReads = 0;
    let heldSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      expect(location.hash).toBe(""); const path = String(input);
      if (path === "/api/auth/session") { sessionReads++; return Response.json({ session: { address: `0x${"d".repeat(40)}`, role: "asker" } }); }
      if (path === "/api/auth/signout") return signout;
      expect(path).toBe("/api/me/chat-accounts");
      if (init.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ action: "preview", token }); previews++;
        return Response.json({ account, recipient, expiresAt: 2000000000000, consentProof: `2000000000000.${"c".repeat(64)}` });
      }
      listReads++;
      if (hold) {
        hold = false; heldSignal = init.signal; const response = new Response(null);
        vi.spyOn(response, "json").mockImplementation(() => oldBody); return response;
      }
      return Response.json(listStatus === 200 ? { account, links: [] } : {}, { status: listStatus });
    }));
    executeBootstrap();
    const container = document.createElement("div"), root = createRoot(container);
    let auth: ReturnType<typeof useSiweAuth> | undefined;
    function CanonicalConsumer() { auth = useSiweAuth(); return null; }
    const load = () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Load account and chat links")!;
    const cleared = () => {
      expect(container.textContent).not.toContain(account.accountId); expect(container.textContent).not.toContain(recipient.userId);
      expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    };
    let attempt: Promise<void> | undefined;
    try {
      await act(async () => { root.render(createElement("div", null, createElement(CanonicalConsumer), createElement(ChatAccountLinks))); });
      expect(previews).toBe(1); expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
      hold = true; await act(async () => { load().click(); });
      const reads = listReads, sessions = sessionReads;
      await act(async () => { attempt = auth!.signOut().catch(() => undefined); });
      cleared(); expect(heldSignal?.aborted).toBe(true);
      await act(async () => { window.dispatchEvent(new Event("focus")); load().click(); });
      expect(listReads).toBe(reads); expect(sessionReads).toBe(sessions);
      await act(async () => { resolveBody({ account, links: [{ ...recipient, linkedAt: 1000 }] }); });
      cleared(); expect(listReads).toBe(reads);
      await act(async () => { resolveSignout(Response.json({ ok: confirmed }, { status: confirmed ? 200 : 503 })); await attempt; });
      cleared(); expect(listReads).toBe(reads);
      listStatus = 401; await act(async () => { load().click(); }); cleared();
      expect(container.textContent).toContain("Sign in");
      listStatus = 200; await act(async () => { window.dispatchEvent(new Event("focus")); });
      expect(sessionReads).toBeGreaterThan(sessions); expect(listReads).toBe(reads + 2);
      expect(previews).toBe(1); cleared(); // Fresh session/list cannot revive the old intake or body.
    } finally {
      resolveSignout(Response.json({ ok: false }, { status: 503 }));
      await act(async () => { await attempt; root.unmount(); });
    }
  });
});

describe("pre-take auth revocation (UNRUN)", () => {
  it.each(["canonical helper", "literal changed"] as const)("revokes before take on %s and cannot preview after later successful reads", async boundary => {
    const account = { accountId: "acct_" + "b".repeat(64), revision: 1 };
    const recipient = { platform: "slack", scope: "TPRIVATE", userId: "UPRIVATE", channel: "DPRIVATE" };
    // Synthetic channel transport only; the actual notifier and one-time holder run intact.
    vi.stubGlobal("BroadcastChannel", class { postMessage() {} close() {} });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      expect(location.hash).toBe(""); expect(location.search).toBe("");
      expect(String(input)).toBe("/api/me/chat-accounts"); expect(String(input)).not.toContain(token);
      return Response.json(init.method === "POST"
        ? { account, recipient, expiresAt: 2000000000000, consentProof: "2000000000000." + "c".repeat(64) }
        : { account, links: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    executeBootstrap();
    expect(fetcher).not.toHaveBeenCalled(); // No initial 401/409 classification exists before this boundary.
    if (boundary === "canonical helper") notifyBrowserAuthChanged();
    else window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "changed" }));
    // Observe the real closure's return during the component's first take without consuming it early.
    const originalTake = Reflect.get(window, slot) as () => ReturnType<typeof takeChatAccountFragment> | null;
    const observedTake = vi.fn(() => originalTake());
    Object.defineProperty(window, slot, { configurable: true, value: observedTake });
    const container = document.createElement("div"), root = createRoot(container);
    const noPreview = () => {
      expect(container.querySelector('input[type="checkbox"]')).toBeNull();
      expect(container.textContent).not.toContain(recipient.userId);
      expect(container.textContent).not.toContain(token);
      expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET" && init?.body === undefined)).toBe(true);
    };
    try {
      await act(async () => { root.render(createElement(ChatAccountLinks)); });
      expect(observedTake).toHaveBeenCalledTimes(1);
      expect(observedTake.mock.results[0]?.value).toEqual({ token: null, pendingLogouts: [] });
      expect(fetcher).toHaveBeenCalledTimes(1); noPreview();
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      expect(fetcher).toHaveBeenCalledTimes(2); noPreview();
      const load = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Load account and chat links")!;
      await act(async () => { load.click(); });
      expect(fetcher).toHaveBeenCalledTimes(3); noPreview();
      expect(observedTake).toHaveBeenCalledTimes(1);
      expect(takeChatAccountFragment()).toEqual({ token: null, pendingLogouts: [] });
    } finally { await act(async () => root.unmount()); }
  });
});
