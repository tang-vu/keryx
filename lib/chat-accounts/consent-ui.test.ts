// @vitest-environment jsdom
// Mounted DOM controls, authored only; execution remains UNRUN for this successor.
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatAccountLinks } from "../../components/keryx/chat-account-links";

const token = "a".repeat(64), account = { accountId: `acct_${"b".repeat(64)}`, revision: 1 };
const recipient = { platform: "slack", scope: "TPRIVATE", userId: "UPRIVATE", channel: "DPRIVATE" };
const listed = { ...recipient, linkedAt: 1000 };
const view = { recipient, account, expiresAt: 2000000000000, consentProof: `2000000000000.${"c".repeat(64)}` };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { resolve, promise };
}
class AuthChannel {
  static instances: AuthChannel[] = [];
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) { AuthChannel.instances.push(this); }
  postMessage(data: unknown) {
    for (const peer of AuthChannel.instances) if (peer !== this && !peer.closed && peer.name === this.name)
      peer.onmessage?.(new MessageEvent("message", { data }));
  }
  close() { this.closed = true; }
}
let root: Root | undefined, container: HTMLDivElement;
let calls: Array<{ path: string; init: RequestInit; result: ReturnType<typeof deferred<Response>> }>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  AuthChannel.instances = []; vi.stubGlobal("BroadcastChannel", AuthChannel); calls = [];
  window.history.replaceState(null, "", `/me/chat-accounts#token=${token}`);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    expect(window.location.hash).toBe("");
    const path = String(input); expect(path).not.toContain(token);
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer", mode: "same-origin", redirect: "error" });
    expect(init.signal).toBeDefined();
    const result = deferred<Response>(); calls.push({ path, init, result }); return result.promise;
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const data = (links = [listed]) => ({ account, links });
const button = (text: string) => Array.from(container.querySelectorAll("button")).find(value => value.textContent === text)!;
const check = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]');
async function click(text: string) { await act(async () => { button(text).click(); }); }
async function reply(index: number, value: unknown, status = 200) {
  await act(async () => { calls[index].result.resolve(Response.json(value, { status })); });
}
async function mount(strict = false) {
  await act(async () => { root!.render(strict ? createElement(StrictMode, null, createElement(ChatAccountLinks)) : createElement(ChatAccountLinks)); });
}
async function ready() {
  await mount(); await reply(0, data()); await reply(1, view);
  expect(check()?.checked).toBe(false);
  await act(async () => { check()!.click(); });
  expect(check()?.checked).toBe(true); expect(button("Confirm chat link").disabled).toBe(false);
}
type Boundary = "logout" | "replacement" | "channel" | "focus";
async function invalidate(boundary: Boundary) {
  await act(async () => {
    if (boundary === "channel") {
      const peer = new AuthChannel("keryx-auth-v1"); peer.postMessage("changed"); peer.close();
    } else if (boundary === "focus") window.dispatchEvent(new Event("focus"));
    else window.dispatchEvent(new CustomEvent("keryx:auth", { detail: boundary === "logout" ? "signed-out" : "changed" }));
  });
}
function privateCleared() {
  expect(container.textContent).not.toContain(account.accountId);
  expect(container.textContent).not.toContain(recipient.userId);
  expect(container.textContent).not.toContain(recipient.scope);
  expect(check()).toBeNull(); expect(container.textContent).not.toContain(token);
}
describe("chat263 mounted consent boundaries (UNRUN)", () => {
  it("retains initial unauthenticated intake for sign-in and separate-tab enrollment, then requires fresh preview and checkbox", async () => {
    await mount(); await reply(0, {}, 401); privateCleared();
    const link = container.querySelector<HTMLAnchorElement>('a[href="/account"]')!;
    expect(link.target).toBe("_blank"); expect(link.rel).toContain("noopener"); expect(link.rel).toContain("noreferrer");
    expect(link.getAttribute("referrerpolicy")).toBe("no-referrer"); expect(link.href).not.toContain(token);
    await invalidate("replacement"); await reply(1, {}, 409);
    await invalidate("focus"); await reply(2, data());
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ action: "preview", token });
    await reply(3, view); expect(check()?.checked).toBe(false); expect(button("Confirm chat link").disabled).toBe(true);
    expect(calls.some(call => call.path.endsWith("/complete"))).toBe(false);
    await act(async () => { check()!.click(); }); await click("Confirm chat link");
    expect(JSON.parse(String(calls[4].init.body))).toEqual({ token, consentProof: view.consentProof, ...account,
      consent: { version: 1, linkFutureRuns: true, financialAuthorityUnchanged: true }, pastRunIds: [] });
    await reply(4, { linked: true }); await reply(5, data()); expect(check()).toBeNull();
  });
  it.each<Boundary>(["logout", "replacement", "channel", "focus"])("clears settled private consent before revalidation on %s, including same-wallet changes", async boundary => {
    await ready(); const count = calls.length;
    await invalidate(boundary); privateCleared();
    expect(calls[1].init.signal?.aborted).toBe(true);
    if (boundary === "logout") await click("Load account and chat links");
    await reply(count, data([]));
    expect(calls).toHaveLength(count + 1); // Token destroyed: no stale preview after a successful same-account read.
    expect(check()).toBeNull();
  });
  for (const phase of ["load", "preview", "complete", "completion-refresh", "unlink", "unlink-refresh"] as const) {
    it.each<Boundary>(["logout", "channel", "focus"])(`fences a late ${phase} response body across %s`, async boundary => {
      await ready();
      if (phase === "load" || phase === "preview") {
        await click("Load account and chat links");
        if (phase === "preview") await reply(2, data());
      } else if (phase === "complete" || phase === "completion-refresh") {
        await click("Confirm chat link");
        if (phase === "completion-refresh") await reply(2, { linked: true });
      } else {
        await click("Unlink"); if (phase === "unlink-refresh") await reply(2, { unlinked: true });
      }
      const index = calls.length - 1, delayed = deferred<unknown>(), response = new Response(null);
      vi.spyOn(response, "json").mockImplementation(() => delayed.promise);
      await act(async () => { calls[index].result.resolve(response); });
      await invalidate(boundary); privateCleared();
      expect(calls[index].init.signal?.aborted).toBe(true); const count = calls.length;
      await act(async () => { delayed.resolve(phase === "preview" ? view : data()); });
      privateCleared(); expect(calls).toHaveLength(count);
    });
  }
  it("fences a late fetch before body parsing and aborts it on logout", async () => {
    await ready(); await click("Load account and chat links"); const response = Response.json(data());
    const json = vi.spyOn(response, "json"); await invalidate("logout"); await act(async () => { calls[2].result.resolve(response); });
    expect(json).not.toHaveBeenCalled(); expect(calls[2].init.signal?.aborted).toBe(true); privateCleared();
  });
  it.each([401, 409, 503])("clears failed private reload projections on HTTP %s", async status => {
    await ready(); await click("Load account and chat links"); await reply(2, {}, status); privateCleared();
    await click("Load account and chat links"); await reply(3, data([])); expect(calls).toHaveLength(4); expect(check()).toBeNull();
  });
  it("retains initial intake through React effect replay but cleans listeners, channel and pending body on real unmount", async () => {
    await mount(true); expect(calls).toHaveLength(2); expect(calls[0].init.signal?.aborted).toBe(true);
    await reply(1, data()); expect(JSON.parse(String(calls[2].init.body))).toEqual({ action: "preview", token });
    const pendingBody = deferred<unknown>(), response = new Response(null);
    vi.spyOn(response, "json").mockImplementation(() => pendingBody.promise);
    await act(async () => { calls[2].result.resolve(response); });
    await act(async () => root!.unmount()); root = undefined;
    expect(calls[2].init.signal?.aborted).toBe(true); expect(AuthChannel.instances.every(channel => channel.closed)).toBe(true);
    const count = calls.length; await invalidate("channel"); await invalidate("focus"); await invalidate("replacement");
    await act(async () => { pendingBody.resolve(view); }); expect(calls).toHaveLength(count); expect(container.textContent).toBe("");
  });
  it("invalidates on direct focus even when BroadcastChannel is unavailable, and clears on page departure", async () => {
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("Unavailable"); } });
    await ready(); await invalidate("focus"); privateCleared(); await reply(2, data([]));
    await act(async () => { window.dispatchEvent(new Event("pagehide")); }); privateCleared();
  });
});
