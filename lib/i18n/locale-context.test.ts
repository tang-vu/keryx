// @vitest-environment jsdom
import React, { act, useEffect, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "./locale-context";
import { LanguageSwitcher } from "@/components/keryx/language-switcher";
import { preparedLocales, shippedUiLocales, type UiLocale } from "./locales";
import { encodeLocaleValue, localeScopeKey } from "./locale-preference";
import * as shellCatalogue from "./ui-shell-catalogue";

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, network = "eip155:5042";
let root: Root | undefined, container: HTMLDivElement, mounts = 0;
function Probe() {
  const { message, locale, status } = useLocale(), [draft, setDraft] = useState("Keep my draft");
  useEffect(() => { mounts++; }, []);
  return React.createElement("section", null, React.createElement(LanguageSwitcher),
    React.createElement("output", { id: "locale" }, locale), React.createElement("output", { id: "status" }, status),
    React.createElement("p", { id: "ask" }, message("shellNavigation.ask")),
    React.createElement("textarea", { id: "draft", value: draft, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value) }),
    React.createElement("input", { id: "editor", defaultValue: "Unsubmitted editor content" }),
    React.createElement("a", { id: "public", href: "/dispatch/original?view=receipt#evidence" }, "Original report"));
}
function reply(owner: string, locale: string | null) {
  return Response.json({ version: 1, owner, locale, network, origin: window.location.origin, acceptLanguage: "en" });
}
function fixture() {
  let owner: string | null = alice, failWrites = false;
  let sessionFailure: "status" | "reject" | "timeout" | "malformed" | null = null;
  const values = new Map<string, string | null>([[alice, "en"], [bob, "zh-Hans"]]);
  const puts: { wallet: string | null; body: unknown; credentials: unknown; redirect: unknown }[] = [];
  let delay: Promise<void> | null = null;
  const fetcher = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    if (String(path) === "/api/auth/session") {
      if (sessionFailure === "status") return new Response(null, { status: 503 });
      if (sessionFailure === "reject") throw new Error("Synthetic session outage");
      if (sessionFailure === "malformed") return Response.json({ session: null });
      if (sessionFailure === "timeout") return new Promise<Response>((_, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("Synthetic deadline", "AbortError")), { once: true });
      });
      return owner ? Response.json({ session: { address: owner, role: "asker" } }) : new Response(null, { status: 401 });
    }
    const expected = new Headers(init?.headers).get("x-keryx-expected-wallet");
    const captured = owner, value = values.get(captured ?? "") ?? null;
    if (init?.method === "PUT") {
      puts.push({ wallet: expected, body: JSON.parse(String(init.body)), credentials: init.credentials, redirect: init.redirect });
      if (failWrites) return new Response(null, { status: 503 });
      const next = JSON.parse(String(init.body)).locale; values.set(captured!, next); return reply(captured!, next);
    }
    if (delay) await delay;
    return captured ? reply(captured, value) : new Response(null, { status: 401 });
  }) as typeof fetch;
  return { fetcher, puts, setOwner: (value: string | null) => { owner = value; }, failWrites: () => { failWrites = true; },
    setSessionFailure: (value: typeof sessionFailure) => { sessionFailure = value; },
    delayRead: () => { let release!: () => void; delay = new Promise<void>(resolve => { release = resolve; }); return () => { delay = null; release(); }; } };
}
function tree(fetcher: typeof fetch, offered: readonly UiLocale[] = preparedLocales, realm: { network?: string; connectedWallet?: string | null } = {}) {
  // createElement supplies the required children through its third argument.
  return React.createElement(LocaleProvider, { network, ...realm, fetcher, enabledLocales: offered } as React.ComponentProps<typeof LocaleProvider>, React.createElement(Probe));
}
async function mount(fetcher: typeof fetch, offered: readonly UiLocale[] = preparedLocales, realm: { network?: string; connectedWallet?: string | null } = {}) {
  root = createRoot(container);
  await act(async () => { root!.render(tree(fetcher, offered, realm)); });
  await vi.waitFor(() => expect(container.querySelector("select")?.disabled).toBe(false));
}
async function refocus() {
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await vi.waitFor(() => expect(container.querySelector("select")?.disabled).toBe(false));
}
function key(owner: string | null, realmNetwork = network) {
  return localeScopeKey({ origin: window.location.origin, network: realmNetwork, owner });
}
function seedScopes() {
  for (const owner of [null, alice, bob]) localStorage.setItem(key(owner), encodeLocaleValue("zh-Hans"));
}
async function choose(locale: string) {
  await act(async () => {
    const select = container.querySelector("select")!; select.value = locale;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(() => expect(container.querySelector("#locale")?.textContent).toBe(locale));
}
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); mounts = 0; container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("renders identical English before hydration even with a stored preview, then sets html language", async () => {
  const f = fixture(); f.setOwner(null);
  localStorage.setItem(localeScopeKey({ origin: window.location.origin, network, owner: null }), encodeLocaleValue("vi"));
  const provider = tree(f.fetcher);
  const markup = renderToString(provider); expect(markup).toContain("Ask a question"); expect(markup).not.toContain("Đặt câu hỏi");
  container.innerHTML = markup; const errors: unknown[] = [];
  await act(async () => { root = hydrateRoot(container, provider, { onRecoverableError: error => errors.push(error) }); });
  await vi.waitFor(() => expect(document.documentElement.lang).toBe("vi"));
  expect(document.documentElement.dir).toBe("ltr"); expect(errors).toEqual([]);
});
it("keeps drafts, editor DOM, public URL and mounted children through two target changes", async () => {
  const f = fixture(); await mount(f.fetcher);
  const editor = container.querySelector<HTMLInputElement>("#editor")!; editor.value = "Retain unsaved edits";
  const draft = container.querySelector<HTMLTextAreaElement>("#draft")!;
  await choose("vi"); await choose("zh-Hans");
  expect(container.querySelector("#draft")).toBe(draft); expect(draft.value).toBe("Keep my draft");
  expect(container.querySelector("#editor")).toBe(editor); expect(editor.value).toBe("Retain unsaved edits");
  expect(mounts).toBe(1); expect(container.querySelector("#public")?.getAttribute("href")).toBe("/dispatch/original?view=receipt#evidence");
  await vi.waitFor(() => expect(f.puts.length).toBeGreaterThan(0));
  for (const put of f.puts) {
    expect(put.wallet).toBe(alice); expect(Object.keys(put.body as object).sort()).toEqual(["locale", "version"]);
    expect(put.credentials).toBe("same-origin"); expect(put.redirect).toBe("error");
  }
});
it("ignores a delayed stored response after explicit choice", async () => {
  const f = fixture(), release = f.delayRead(); await mount(f.fetcher);
  await choose("vi"); await act(async () => release());
  expect(container.querySelector("#locale")?.textContent).toBe("vi");
});
it("drops late account responses on owner change and restores the guest scope on logout", async () => {
  const f = fixture(), release = f.delayRead(); await mount(f.fetcher);
  f.setOwner(bob); await act(async () => window.dispatchEvent(new Event("keryx:auth")));
  await act(async () => release()); await vi.waitFor(() => expect(container.querySelector("#locale")?.textContent).toBe("zh-Hans"));
  f.setOwner(null); await act(async () => window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" })));
  await vi.waitFor(() => expect(container.querySelector("#locale")?.textContent).toBe("en"));
  expect(localStorage.getItem(localeScopeKey({ origin: window.location.origin, network, owner: bob }))).toBeNull();
  expect(localStorage.getItem(localeScopeKey({ origin: window.location.origin, network, owner: null }))).toBeNull();
});
it("reports failed account writes and keeps an explicit browser choice", async () => {
  const f = fixture(); f.failWrites(); await mount(f.fetcher); await choose("vi");
  await vi.waitFor(() => expect(container.querySelector('[role="status"]')?.textContent).toContain("unavailable"));
  expect(container.querySelector("#locale")?.textContent).toBe("vi");
  expect(localStorage.getItem(localeScopeKey({ origin: window.location.origin, network, owner: alice }))).toBe(encodeLocaleValue("vi"));
  await refocus();
  expect(container.querySelector("#locale")?.textContent).toBe("vi");
  expect(container.querySelector("#status")?.textContent).not.toBe("accountSaved");
  expect(f.puts).toHaveLength(1);
});
it("keeps a guest's memory-only choice across focus and storage refreshes when storage is denied", async () => {
  const f = fixture(); f.setOwner(null);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Synthetic storage denial"); });
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Synthetic storage denial"); });
  await mount(f.fetcher); await choose("vi");
  expect(container.querySelector("#status")?.textContent).toBe("memoryOnly");
  await refocus(); expect(container.querySelector("#locale")?.textContent).toBe("vi");
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: key(null) })); });
  await vi.waitFor(() => expect(container.querySelector("select")?.disabled).toBe(false));
  expect(container.querySelector("#locale")?.textContent).toBe("vi");
  expect(write).toHaveBeenCalledTimes(1); expect(f.puts).toEqual([]);
});
it("retains account intent on refocus when both browser storage and the account PUT fail", async () => {
  const f = fixture(); f.failWrites();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Synthetic storage denial"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Synthetic storage denial"); });
  await mount(f.fetcher); await choose("vi");
  await vi.waitFor(() => expect(f.puts).toHaveLength(1));
  expect(container.querySelector("#status")?.textContent).toBe("memoryOnly");
  await refocus(); expect(container.querySelector("#locale")?.textContent).toBe("vi");
});
it.each(["status", "reject", "malformed"] as const)("keeps %s session identity unknown and never accesses durable scopes", async failure => {
  seedScopes(); const f = fixture(); f.setSessionFailure(failure);
  const read = vi.spyOn(Storage.prototype, "getItem"), write = vi.spyOn(Storage.prototype, "setItem");
  await mount(f.fetcher); expect(container.querySelector("#locale")?.textContent).toBe("en");
  expect(container.querySelector("#status")?.textContent).toBe("unavailable");
  await choose("vi"); expect(container.querySelector("#status")?.textContent).toBe("memoryOnly");
  await refocus(); expect(container.querySelector("#locale")?.textContent).toBe("vi");
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(f.puts).toEqual([]);
  f.setSessionFailure(null); await refocus();
  expect(container.querySelector("#locale")?.textContent).toBe("en");
  f.setOwner(null); await act(async () => { window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" })); });
  await vi.waitFor(() => expect(container.querySelector("#locale")?.textContent).toBe("zh-Hans"));
  expect(write).not.toHaveBeenCalled();
  for (const owner of [null, alice, bob]) expect(localStorage.getItem(key(owner))).toBe(encodeLocaleValue("zh-Hans"));
});
it("keeps a session deadline unknown and allows only a memory choice after timeout", async () => {
  seedScopes(); const f = fixture(); f.setSessionFailure("timeout");
  const read = vi.spyOn(Storage.prototype, "getItem"), write = vi.spyOn(Storage.prototype, "setItem");
  vi.useFakeTimers(); root = createRoot(container);
  await act(async () => { root!.render(tree(f.fetcher)); });
  expect(container.querySelector("select")?.disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  vi.useRealTimers();
  expect(container.querySelector("#status")?.textContent).toBe("unavailable");
  await choose("vi"); expect(container.querySelector("#status")?.textContent).toBe("memoryOnly");
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(f.puts).toEqual([]);
});
it("keeps a connected-wallet mismatch unknown without reading or writing guest or either wallet", async () => {
  seedScopes(); const f = fixture();
  const read = vi.spyOn(Storage.prototype, "getItem"), write = vi.spyOn(Storage.prototype, "setItem");
  await mount(f.fetcher, preparedLocales, { connectedWallet: bob });
  expect(container.querySelector("#status")?.textContent).toBe("unavailable");
  await choose("vi"); expect(container.querySelector("#status")?.textContent).toBe("memoryOnly");
  await refocus(); expect(container.querySelector("#locale")?.textContent).toBe("vi");
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(f.puts).toEqual([]);
  f.setOwner(bob); await refocus();
  expect(container.querySelector("#locale")?.textContent).toBe("zh-Hans"); expect(write).not.toHaveBeenCalled();
});
it("retains last-confirmed-owner intent through an outage without persisting unknown selections", async () => {
  const f = fixture(); f.failWrites(); await mount(f.fetcher); await choose("vi");
  await vi.waitFor(() => expect(f.puts).toHaveLength(1));
  f.setSessionFailure("status"); const write = vi.spyOn(Storage.prototype, "setItem");
  await refocus(); expect(container.querySelector("#locale")?.textContent).toBe("vi");
  await choose("zh-Hans"); expect(container.querySelector("#status")?.textContent).toBe("memoryOnly");
  expect(write).not.toHaveBeenCalled(); expect(f.puts).toHaveLength(1);
  f.setSessionFailure(null); await refocus(); expect(container.querySelector("#locale")?.textContent).toBe("zh-Hans");
  expect(localStorage.getItem(key(alice))).toBe(encodeLocaleValue("vi"));
  f.setOwner(bob); await refocus();
  await choose("en"); await vi.waitFor(() => expect(f.puts).toHaveLength(2));
  f.setOwner(alice); await refocus(); expect(container.querySelector("#locale")?.textContent).toBe("en");
  expect(localStorage.getItem(key(null))).toBeNull();
});
it("clears explicit intent for a new network and genuine logout", async () => {
  const f = fixture(); f.setOwner(null); await mount(f.fetcher); await choose("vi");
  const otherNetwork = "eip155:5042002";
  await act(async () => { root!.render(tree(f.fetcher, preparedLocales, { network: otherNetwork })); });
  await vi.waitFor(() => expect(container.querySelector("#locale")?.textContent).toBe("en"));
  expect(localStorage.getItem(key(null, otherNetwork))).toBeNull();
  await choose("zh-Hans"); f.setOwner(alice);
  await act(async () => { root!.render(tree(f.fetcher)); });
  await vi.waitFor(() => expect(container.querySelector("#locale")?.textContent).toBe("en"));
  f.failWrites(); await choose("zh-Hans");
  f.setOwner(null); await act(async () => { window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" })); });
  await vi.waitFor(() => expect(container.querySelector("#locale")?.textContent).toBe("vi"));
});
it("uses the unchanged shipped-English allowlist by default", async () => {
  const f = fixture(); await mount(f.fetcher, shippedUiLocales);
  expect([...container.querySelectorAll("option")].map(option => option.value)).toEqual(["en"]);
});
it("shows English and an honest load failure when the selected catalogue rejects", async () => {
  const original = shellCatalogue.loadUiShellCatalogue;
  vi.spyOn(shellCatalogue, "loadUiShellCatalogue").mockImplementation((locale, ...args) => locale === "vi" ? Promise.reject(new Error("Synthetic chunk refusal")) : original(locale, ...args));
  const f = fixture(); f.setOwner(null); await mount(f.fetcher);
  await act(async () => { const select = container.querySelector("select")!; select.value = "vi"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await vi.waitFor(() => expect(container.querySelector('[role="status"]')?.textContent).toContain("could not load"));
  expect(container.querySelector("#ask")?.textContent).toBe("Ask a question"); expect(document.documentElement.lang).toBe("en");
});
