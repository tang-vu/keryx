// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import { RunPrivacyControls } from "../../app/me/run-privacy/run-privacy-controls";
import { runPrivacyCopy as copy } from "../../locales/en/run-privacy";

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const defaultPath = "/api/me/run-privacy/default";
type Visibility = "private" | "unlisted" | "public";
type Kind = "default" | "visibility" | "erase" | "export";
type Boundary = "window" | "channel" | "focus";
// Model separate browser endpoints: a sender never receives its own message.
// Deliver the canonical channel's MessageEvent, without a window auth event.
class AuthChannel {
  static instances: AuthChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly name: string) { AuthChannel.instances.push(this); }
  postMessage(data: unknown) {
    for (const peer of AuthChannel.instances) {
      if (peer !== this && !peer.closed && peer.name === this.name) peer.onmessage?.(new MessageEvent("message", { data }));
    }
  }
  close() { this.closed = true; }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function defaults(wallet = alice, visibility: Visibility = "private") { return Response.json({ wallet, visibility }); }
function state(visibility: Visibility = "private", revision = 0, erased = false) { return { visibility, revision, erased }; }
function record(wallet = alice, id = "alice-run", revision = 0) {
  return Response.json({ wallet, state: state("private", revision), run: { id, question: `${id} private question` } });
}
function delayedJson(status = 200) {
  const body = deferred<unknown>(), response = new Response(null, { status });
  const json = vi.spyOn(response, "json").mockImplementation(() => body.promise);
  return { response, body, json };
}
function delayedBlob() {
  const body = deferred<Blob>(), response = new Response(null);
  const blob = vi.spyOn(response, "blob").mockImplementation(() => body.promise);
  return { response, body, blob };
}

let root: Root | undefined, container: HTMLDivElement;
let calls: Array<{ path: string; init: RequestInit; response: ReturnType<typeof deferred<Response>> }>;
let fetcher: ReturnType<typeof vi.fn>;
let createUrl: Mock<typeof URL.createObjectURL>, revokeUrl: Mock<typeof URL.revokeObjectURL>;
let download: MockInstance<() => void>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  AuthChannel.instances = []; vi.stubGlobal("BroadcastChannel", AuthChannel);
  // Each request remains pending until its actual DOM fixture explicitly releases it.
  calls = [];
  fetcher = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input), url = new URL(path, window.location.href);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname.startsWith("/api/me/run-privacy/")).toBe(true);
    expect(init).toMatchObject({ credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store" });
    const response = deferred<Response>(); calls.push({ path, init, response }); return response.promise;
  });
  vi.stubGlobal("fetch", fetcher);
  let sequence = 0;
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`) });
  createUrl = vi.fn<typeof URL.createObjectURL>(() => "blob:synthetic-owner-export"); revokeUrl = vi.fn<typeof URL.revokeObjectURL>();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
  download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  window.history.replaceState(null, "", "/me/run-privacy");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; container.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(response = defaults()) {
  await act(async () => { root!.render(createElement(RunPrivacyControls)); });
  expect(calls[0].path).toBe(defaultPath);
  expect(new Headers(calls[0].init.headers).has("X-Keryx-Expected-Wallet")).toBe(false);
  await reply(0, response);
}
async function reply(index: number, response: Response) { await act(async () => { calls[index].response.resolve(response); }); }
async function fail(index: number) { await act(async () => { calls[index].response.reject(new Error(copy.retry)); }); }
async function finish<T>(body: ReturnType<typeof deferred<T>>, value: T) { await act(async () => { body.resolve(value); }); }
function button(text: string) { return Array.from(container.querySelectorAll("button")).find(item => item.textContent === text)!; }
function status() { return container.querySelector('[role="status"]')!.textContent; }
function runInput() { return container.querySelector('input:not([type="checkbox"])') as HTMLInputElement; }
function defaultSelect() { return container.querySelector("select")!; }
function visibilitySelect() { return container.querySelectorAll("select")[1]; }
function blocked() { return button(copy.load).matches(":disabled"); }
async function click(text: string) { await act(async () => { button(text).click(); }); }
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function enter(id: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(runInput(), id);
    runInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function load(wallet = alice, id = "alice-run", revision = 0) {
  await enter(id); await click(copy.load); const index = calls.length - 1;
  expect(calls[index].path).toBe(`/api/me/run-privacy/${id}`);
  expect(new Headers(calls[index].init.headers).get("X-Keryx-Expected-Wallet")).toBe(wallet);
  await reply(index, record(wallet, id, revision));
  expect(container.textContent).toContain(`${id} private question`);
}
async function auth(signedOut = false) {
  await act(async () => { window.dispatchEvent(new CustomEvent("keryx:auth", { detail: signedOut ? "signed-out" : "changed" })); });
}
async function channel(detail = "changed") {
  await act(async () => {
    const peer = new BroadcastChannel("keryx-auth-v1");
    peer.postMessage(detail); peer.close();
  });
}
async function freshen(boundary: Boundary) {
  if (boundary === "window") await auth();
  else if (boundary === "channel") await channel();
  else await act(async () => { window.dispatchEvent(new Event("focus")); });
}
async function switchToBob(boundary: Boundary = "window") {
  const count = calls.length; await freshen(boundary);
  expect(runInput().value).toBe(""); expect(blocked()).toBe(true);
  expect(container.textContent).not.toContain("alice-run private question");
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  expect(defaultSelect().value).toBe("private");
  expect(calls).toHaveLength(count + 1); expect(calls[count].path).toBe(defaultPath);
  expect(calls[count].init.method).toBeUndefined();
  expect(new Headers(calls[count].init.headers).has("X-Keryx-Expected-Wallet")).toBe(false);
  await reply(count, defaults(bob, "unlisted"));
  expect(blocked()).toBe(false); expect(defaultSelect().value).toBe("unlisted");
  expect(status()).toBe(""); expect(calls).toHaveLength(count + 1);
}
async function start(kind: Kind) {
  if (kind === "default") await choose(defaultSelect(), "public");
  if (kind === "visibility") await choose(visibilitySelect(), "unlisted");
  if (kind === "erase") await act(async () => { (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
  await click({ default: copy.saveDefault, visibility: copy.saveVisibility, erase: copy.erase, export: copy.export }[kind]);
  return calls.length - 1;
}
function requestId(index: number) {
  const call = calls[index]; return call.init.method ? JSON.parse(String(call.init.body)).requestId : new Headers(call.init.headers).get("X-Keryx-Request-Id");
}
function successful(kind: Kind, wallet = alice, revision = 1) {
  return kind === "default" ? defaults(wallet, "public") : kind === "export" ? new Response("synthetic owner export") : Response.json(state(kind === "erase" ? "private" : "unlisted", revision, kind === "erase"));
}

describe("RunPrivacyControls owner generations in the actual DOM", () => {
  it("clears private drafts on auth change and refreshes only authenticated defaults", async () => {
    window.history.replaceState(null, "", "/me/run-privacy?run=alice-run");
    await mount(); expect(runInput().value).toBe("alice-run"); expect(calls).toHaveLength(1);
    await load(); await choose(defaultSelect(), "public"); await choose(visibilitySelect(), "public");
    await act(async () => { (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await switchToBob();
    expect(container.querySelectorAll("select")).toHaveLength(1);
    await load(bob, "bob-run", 7);
    const index = await start("visibility"), input = JSON.parse(String(calls[index].init.body));
    expect(input).toMatchObject({ revision: 7, visibility: "unlisted" });
    expect(calls[index].init.method).toBe("PATCH");
    expect(new Headers(calls[index].init.headers).get("X-Keryx-Expected-Wallet")).toBe(bob);
    await reply(index, successful("visibility", bob, 8)); expect(status()).toBe(copy.saved);
  });

  it.each((["fetch", "json"] as const).flatMap(phase => (["window", "channel"] as const).map(boundary => [phase, boundary] as const)))("ignores a stale %s default completion after %s auth and never automatically loads a selected run", async (phase, boundary) => {
    await act(async () => { root!.render(createElement(RunPrivacyControls)); });
    const delayed = delayedJson(); if (phase === "json") await reply(0, delayed.response);
    await switchToBob(boundary);
    if (phase === "fetch") await reply(0, defaults(alice, "public"));
    else await finish(delayed.body, { wallet: alice, visibility: "public" });
    expect(defaultSelect().value).toBe("unlisted"); expect(runInput().value).toBe("");
    expect(status()).toBe(""); expect(calls).toHaveLength(2);
  });

  it("signed-out invalidates a delayed default body without reactivating controls or issuing work", async () => {
    const delayed = delayedJson(); await mount(delayed.response);
    await auth(true); await finish(delayed.body, { wallet: alice, visibility: "public" });
    expect(blocked()).toBe(true); expect(status()).toBe(copy.signIn); expect(calls).toHaveLength(1);
    await click(copy.load); await click(copy.saveDefault); expect(calls).toHaveLength(1);
  });

  it.each(["window", "channel"] as const)("%s signed-out clears a loaded owner and defeats a default refresh already reading its body", async boundary => {
    await mount(); await load(); await freshen(boundary); const delayed = delayedJson(); await reply(calls.length - 1, delayed.response);
    const count = calls.length; if (boundary === "channel") await channel("signed-out"); else await auth(true);
    await finish(delayed.body, { wallet: alice, visibility: "public" });
    expect(runInput().value).toBe(""); expect(blocked()).toBe(true); expect(status()).toBe(copy.signIn);
    expect(container.textContent).not.toContain("alice-run private question"); expect(calls).toHaveLength(count);
  });

  it.each(["channel", "focus"] as const)("%s freshness clears retained private text and consent before new defaults resolve", async boundary => {
    await mount(); await load(); await choose(defaultSelect(), "public"); await choose(visibilitySelect(), "public");
    await act(async () => { (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    const count = calls.length; await freshen(boundary);
    expect(blocked()).toBe(true); expect(runInput().value).toBe(""); expect(defaultSelect().value).toBe("private");
    expect(container.textContent).not.toContain("alice-run private question"); expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.querySelectorAll("select")).toHaveLength(1); expect(status()).toBe(copy.accountChanged);
    expect(calls).toHaveLength(count + 1); expect(calls[count].path).toBe(defaultPath); expect(calls[count].init.method).toBeUndefined();
    expect(new Headers(calls[count].init.headers).has("X-Keryx-Expected-Wallet")).toBe(false);
    const delayed = delayedJson(); await reply(count, delayed.response);
    await click(copy.load); await click(copy.saveDefault); expect(calls).toHaveLength(count + 1); expect(blocked()).toBe(true);
    await finish(delayed.body, { wallet: bob, visibility: "unlisted" });
    expect(blocked()).toBe(false); expect(status()).toBe(""); expect(defaultSelect().value).toBe("unlisted"); expect(calls).toHaveLength(count + 1);
    await load(bob, "bob-run"); // New run access is still an explicit owner action.
  });

  it.each(["default-fetch", "default-json", "load-fetch", "load-json", "export-fetch", "export-blob"] as const)("real channel signed-out fences delayed %s without refreshing or issuing owner work", async phase => {
    const delayed = delayedJson(), blob = delayedBlob(); let old = 0;
    if (phase.startsWith("default-")) {
      if (phase === "default-json") await mount(delayed.response);
      else await act(async () => { root!.render(createElement(RunPrivacyControls)); });
    } else {
      await mount();
      if (phase.startsWith("load-")) { await enter("alice-run"); await click(copy.load); old = calls.length - 1; }
      else { await load(); old = await start("export"); }
      if (phase === "load-json" || phase === "export-blob") await reply(old, phase === "export-blob" ? blob.response : delayed.response);
    }
    expect(AuthChannel.instances[0].name).toBe("keryx-auth-v1");
    const count = calls.length, windowDispatch = vi.spyOn(window, "dispatchEvent"); await channel("signed-out");
    expect(windowDispatch).not.toHaveBeenCalled(); // No same-tab event substitutes for the channel notification.
    expect(blocked()).toBe(true); expect(runInput().value).toBe(""); expect(defaultSelect().value).toBe("private");
    expect(container.textContent).not.toContain("alice-run private question"); expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(status()).toBe(copy.signIn); expect(calls).toHaveLength(count);
    if (phase === "default-fetch") await reply(old, defaults(alice, "public"));
    else if (phase === "default-json") await finish(delayed.body, { wallet: alice, visibility: "public" });
    else if (phase === "load-fetch") await reply(old, record());
    else if (phase === "load-json") await finish(delayed.body, { wallet: alice, state: state(), run: { id: "alice-run", question: "alice-run private question" } });
    else if (phase === "export-fetch") await reply(old, successful("export"));
    else await finish(blob.body, new Blob(["old private export"]));
    expect(blocked()).toBe(true); expect(status()).toBe(copy.signIn); expect(container.textContent).not.toContain("alice-run private question");
    expect(createUrl).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(calls).toHaveLength(count);
    await click(copy.load); await click(copy.saveDefault); expect(calls).toHaveLength(count);
  });

  it("channel signed-out clears an already displayed private question without any fetch", async () => {
    await mount(); await load(); const count = calls.length; await channel("signed-out");
    expect(container.textContent).not.toContain("alice-run private question"); expect(blocked()).toBe(true); expect(runInput().value).toBe("");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull(); expect(status()).toBe(copy.signIn); expect(calls).toHaveLength(count);
  });

  it("focus fallback invalidates a preauthorized export even when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("Messaging unavailable"); } });
    await mount(); await load(); const old = await start("export"), blob = delayedBlob(); await reply(old, blob.response);
    const count = calls.length; await freshen("focus");
    expect(blocked()).toBe(true); expect(runInput().value).toBe(""); expect(container.textContent).not.toContain("alice-run private question");
    expect(calls).toHaveLength(count + 1); expect(calls[count].path).toBe(defaultPath);
    await finish(blob.body, new Blob(["old private export"]));
    expect(createUrl).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(blocked()).toBe(true);
    await reply(count, new Response(null, { status: 401 })); expect(blocked()).toBe(true); expect(status()).toBe(copy.signIn);
    await click(copy.load); await click(copy.saveDefault); expect(calls).toHaveLength(count + 1);
  });

  it.each([
    ["signed out", () => new Response(null, { status: 401 })],
    ["unavailable", () => new Response(null, { status: 503 })],
    ["malformed JSON", () => new Response("{", { headers: { "Content-Type": "application/json" } })],
    ["missing wallet", () => Response.json({ visibility: "public" })],
    ["invalid wallet", () => Response.json({ wallet: "unverified", visibility: "public" })],
    ["invalid visibility", () => Response.json({ wallet: alice, visibility: "everyone" })],
    ["wrong endpoint", () => { const response = defaults(); Object.defineProperty(response, "url", { value: "https://foreign.example/api/me/run-privacy/default" }); return response; }],
    ["redirected context", () => { const response = defaults(); Object.defineProperty(response, "redirected", { value: true }); return response; }],
  ] as const)("keeps controls cleared when refreshed defaults are %s", async (_label, response) => {
    await mount(); await load(); await auth(); await reply(calls.length - 1, response());
    expect(blocked()).toBe(true); expect(runInput().value).toBe(""); expect(defaultSelect().value).toBe("private");
    expect(container.textContent).not.toContain("alice-run private question");
    const count = calls.length; await click(copy.load); await click(copy.saveDefault); expect(calls).toHaveLength(count);
  });

  it.each((["fetch", "json", "error-json", "reject"] as const).flatMap(phase => (["window", "channel"] as const).map(boundary => [phase, boundary] as const)))("stale load %s after %s auth cannot display text, change notices or unblock a newer operation", async (phase, boundary) => {
    await mount(); await enter("alice-run"); await click(copy.load); const old = calls.length - 1;
    const delayed = delayedJson(phase === "error-json" ? 409 : 200);
    if (phase === "json" || phase === "error-json") await reply(old, delayed.response);
    await switchToBob(boundary); await enter("bob-run"); await click(copy.load); const current = calls.length - 1;
    if (phase === "fetch") await reply(old, record());
    else if (phase === "reject") await fail(old);
    else await finish(delayed.body, phase === "error-json" ? { error: "retention_hold" } : { wallet: alice, state: state(), run: { id: "alice-run", question: "alice-run private question" } });
    expect(blocked()).toBe(true); expect(status()).toBe(""); expect(container.textContent).not.toContain("alice-run private question");
    await reply(current, record(bob, "bob-run")); expect(blocked()).toBe(false); expect(container.textContent).toContain("bob-run private question");
  });

  it("a current load failure retains the entered run ID and waits for an explicit retry", async () => {
    await mount(); await enter("alice-run"); await click(copy.load); const current = calls.length - 1, count = calls.length;
    await fail(current); expect(blocked()).toBe(false); expect(runInput().value).toBe("alice-run"); expect(status()).toBe(copy.retry);
    expect(calls).toHaveLength(count); await click(copy.load); const retry = calls.length - 1;
    expect(calls[retry].path).toBe(calls[current].path);
    expect(new Headers(calls[retry].init.headers).get("X-Keryx-Expected-Wallet")).toBe(alice);
    await reply(retry, record()); expect(status()).toBe(""); expect(container.textContent).toContain("alice-run private question");
  });

  it.each((["default", "visibility", "erase"] as const).flatMap(kind => (["window", "channel"] as const).map(boundary => [kind, boundary] as const)))("fences delayed %s JSON after %s auth, notices and request IDs from the next owner's retry", async (kind, boundary) => {
    await mount(); await load(); const old = await start(kind), delayed = delayedJson(); await reply(old, delayed.response);
    expect(delayed.json).toHaveBeenCalledOnce();
    await switchToBob(boundary); await load(bob, "bob-run", 7); const current = await start("visibility"), retained = requestId(current);
    await finish(delayed.body, kind === "default" ? { wallet: alice, visibility: "public" } : state(kind === "erase" ? "private" : "unlisted", 1, kind === "erase"));
    expect(blocked()).toBe(true); expect(status()).toBe(""); expect(visibilitySelect().value).toBe("unlisted");
    expect(container.textContent).toContain("bob-run private question"); expect(container.textContent).not.toContain(copy.erasedLabel);
    await reply(current, new Response(null, { status: 503 })); expect(status()).toBe(copy.admission); expect(blocked()).toBe(false);
    await click(copy.saveVisibility); const retry = calls.length - 1;
    expect(requestId(retry)).toBe(retained); expect(calls[retry].init.body).toBe(calls[current].init.body);
    await reply(retry, successful("visibility", bob, 8)); expect(status()).toBe(copy.saved);
  });

  it.each(["window", "channel"] as const)("a stale mutation failure body after %s auth cannot clear the new owner's busy state or replace its notice", async boundary => {
    await mount(); await load(); const old = await start("erase"), delayed = delayedJson(409); await reply(old, delayed.response);
    await switchToBob(boundary); const current = await start("default"), retained = requestId(current);
    await finish(delayed.body, { error: "retention_hold" }); expect(blocked()).toBe(true); expect(status()).toBe("");
    await fail(current); expect(status()).toBe(copy.retry); expect(defaultSelect().value).toBe("public");
    await click(copy.saveDefault); const retry = calls.length - 1; expect(requestId(retry)).toBe(retained);
    await reply(retry, successful("default", bob)); expect(status()).toBe(copy.saved);
  });

  it("channel account switch resets an identical default intent's UUID and protects the new explicit retry", async () => {
    await mount(); const old = await start("default"), delayed = delayedJson(); await reply(old, delayed.response);
    await switchToBob("channel"); const current = await start("default"), retained = requestId(current);
    expect(retained).not.toBe(requestId(old));
    expect(JSON.parse(String(calls[current].init.body)).visibility).toBe(JSON.parse(String(calls[old].init.body)).visibility);
    expect(new Headers(calls[current].init.headers).get("X-Keryx-Expected-Wallet")).toBe(bob);
    await finish(delayed.body, { wallet: alice, visibility: "public" }); expect(blocked()).toBe(true); expect(status()).toBe("");
    const count = calls.length; await fail(current); expect(status()).toBe(copy.retry); expect(calls).toHaveLength(count);
    await click(copy.saveDefault); const retry = calls.length - 1;
    expect(requestId(retry)).toBe(retained); expect(calls[retry].init.body).toBe(calls[current].init.body);
    expect(new Headers(calls[retry].init.headers).get("X-Keryx-Expected-Wallet")).toBe(bob);
    await reply(retry, successful("default", bob)); expect(blocked()).toBe(false); expect(status()).toBe(copy.saved);
  });

  it.each((["fetch", "blob"] as const).flatMap(phase => (["window", "channel"] as const).map(boundary => [phase, boundary] as const)))("a stale export %s after %s auth cannot download or unblock the current owner", async (phase, boundary) => {
    await mount(); await load(); const old = await start("export"), delayed = delayedBlob();
    expect(calls[old].path).toBe("/api/me/run-privacy/alice-run/export"); expect(requestId(old)).toMatch(/^[0-9a-f-]{36}$/);
    if (phase === "blob") await reply(old, delayed.response);
    await switchToBob(boundary); const current = await start("default");
    if (phase === "fetch") await reply(old, successful("export")); else await finish(delayed.body, new Blob(["old private export"]));
    expect(createUrl).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(blocked()).toBe(true); expect(status()).toBe("");
    await reply(current, successful("default", bob)); expect(blocked()).toBe(false);
  });

  it.each(["default", "visibility", "erase", "export"] as const)("current %s failures retain the draft, revision and request ID for explicit retry", async kind => {
    await mount(); await load(); const current = await start(kind), retained = requestId(current), count = calls.length;
    await reply(current, kind === "erase" ? Response.json({ error: "retention_hold" }, { status: 409 }) : new Response(null, { status: 503 }));
    expect(blocked()).toBe(false); expect(status()).toBe(kind === "erase" ? copy.retention : copy.admission);
    expect(runInput().value).toBe("alice-run"); expect(container.textContent).toContain("alice-run private question");
    if (kind === "default") expect(defaultSelect().value).toBe("public");
    if (kind === "visibility") expect(visibilitySelect().value).toBe("unlisted");
    if (kind === "erase") expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(calls).toHaveLength(count); // The failure issues no automatic retry.
    await click({ default: copy.saveDefault, visibility: copy.saveVisibility, erase: copy.erase, export: copy.export }[kind]);
    const retry = calls.length - 1; expect(requestId(retry)).toBe(retained); expect(calls[retry].init.body).toBe(calls[current].init.body);
    await reply(retry, successful(kind)); expect(status()).toBe(kind === "erase" ? copy.erased : copy.saved);
    if (kind === "erase") { expect(container.textContent).not.toContain("alice-run private question"); expect(container.textContent).toContain(copy.erasedLabel); }
    if (kind === "export") {
      expect(createUrl).toHaveBeenCalledOnce(); expect(download).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1000); expect(revokeUrl).toHaveBeenCalledWith("blob:synthetic-owner-export");
    }
  });

  it("wrong-owner default acknowledgement remains failed and retains the same explicit retry", async () => {
    await mount(); const current = await start("default"), retained = requestId(current);
    await reply(current, defaults(bob, "public")); expect(status()).toBe(copy.accountChanged); expect(defaultSelect().value).toBe("public");
    await click(copy.saveDefault); const retry = calls.length - 1; expect(requestId(retry)).toBe(retained);
    expect(new Headers(calls[retry].init.headers).get("X-Keryx-Expected-Wallet")).toBe(alice);
    await reply(retry, successful("default")); expect(status()).toBe(copy.saved);
  });

  it.each(["default-json", "load-fetch", "load-json", "visibility-json", "erase-json", "failure-json", "export-blob"] as const)("unmount invalidates pending %s and removes window, channel and focus subscriptions", async phase => {
    const delayed = delayedJson(phase === "failure-json" ? 409 : 200), blob = delayedBlob();
    let old = 0;
    if (phase === "default-json") await mount(delayed.response);
    else {
      await mount();
      if (phase.startsWith("load-")) { await enter("alice-run"); await click(copy.load); old = calls.length - 1; }
      else { await load(); old = await start(phase === "export-blob" ? "export" : phase === "visibility-json" ? "visibility" : "erase"); }
      if (phase !== "load-fetch") await reply(old, phase === "export-blob" ? blob.response : delayed.response);
    }
    const subscription = AuthChannel.instances[0]; expect(subscription.closed).toBe(false);
    await act(async () => { root!.unmount(); }); root = undefined; expect(subscription.closed).toBe(true);
    const count = calls.length; await auth(); await channel(); await freshen("focus"); expect(calls).toHaveLength(count);
    if (phase === "load-fetch") await reply(old, record());
    else if (phase === "export-blob") await finish(blob.body, new Blob(["old private export"]));
    else await finish(delayed.body, phase === "default-json" ? { wallet: alice, visibility: "public" } : phase === "failure-json" ? { error: "retention_hold" } : phase === "load-json" ? { wallet: alice, state: state(), run: { id: "alice-run", question: "old private question" } } : state(phase === "erase-json" ? "private" : "unlisted", 1, phase === "erase-json"));
    expect(container.textContent).toBe(""); expect(createUrl).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(calls).toHaveLength(count);
  });
});
