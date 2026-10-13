import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerifiedIdentityPanel } from "../../app/me/profile/verified-identity-panel";
import { PrivateProfileView } from "../../app/me/profile/private-profile-view";
import { identityCopy as copy } from "../../locales/en/profile-identities";
import type { IdentitySnapshot, VerifiedIdentity } from "./verified-identities";

const auth = vi.hoisted(() => ({ address: `0x${"a".repeat(40)}` }));
// Only the parent's signed-in session is synthetic; both profile components render normally.
vi.mock("../hooks/use-siwe-auth", () => ({ useSiweAuth: () => ({ session: { address: auth.address } }) }));

const wallet = `0x${"a".repeat(40)}`, otherWallet = `0x${"b".repeat(40)}`;
const verifiedAt = "2026-10-09T06:00:00.000Z";
const github: VerifiedIdentity = { wallet, provider: "github", externalId: "123", label: "stored-user", verifiedAt };
const orcid: VerifiedIdentity = { wallet, provider: "orcid", externalId: "0000-0002-1825-0097", label: "Stored Researcher", verifiedAt };
const snapshot = (identities: VerifiedIdentity[] = [], owner = wallet): IdentitySnapshot => ({ wallet: owner, identities });
const authorizationUrls = {
  github: `https://github.com/login/oauth/authorize?client_id=fixture&redirect_uri=https%3A%2F%2Fkeryx.cc%2Fapi%2Fme%2Fprofile%2Fidentities%2Fgithub%2Fcallback&response_type=code&state=${"s".repeat(43)}&scope=&code_challenge=${"c".repeat(43)}&code_challenge_method=S256`,
  orcid: `https://orcid.org/oauth/authorize?client_id=fixture&redirect_uri=https%3A%2F%2Fkeryx.cc%2Fapi%2Fme%2Fprofile%2Fidentities%2Forcid%2Fcallback&response_type=code&state=${"s".repeat(43)}&scope=%2Fauthenticate`,
};
const disposeFixtures: Array<() => Promise<void>> = [];

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Native response.json() can finish after owner abort; the transport deliberately ignores abort.
function heldBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }),
    { headers: { "Content-Type": "application/json" } });
  return { response, async finish(value: unknown) {
    await act(async () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); });
  } };
}
function fixture(url = "https://keryx.cc/me/profile") {
  const dom = new JSDOM('<div id="root"></div>', { url });
  const navigate = vi.fn<(url: string) => void>();
  const location = { get href() { return dom.window.location.href; }, assign: navigate };
  // Keep the real DOM/history, replacing only navigation so no provider is contacted.
  vi.stubGlobal("window", new Proxy(dom.window, { get(target, key) {
    return key === "location" ? location : Reflect.get(target, key, target);
  } }));
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.history.replaceState({ retained: "fixture-state" }, "", url);
  const replace = vi.spyOn(dom.window.history, "replaceState");
  const requests: Array<{ path: string; init: RequestInit; signal: AbortSignal;
    respond(value: unknown, status?: number): Promise<void>; response(value: Response): Promise<void>;
    reject(error: unknown): Promise<void> }> = [];
  const fetcher = vi.fn<typeof fetch>((input, init) => {
    const reply = deferred<Response>();
    requests.push({ path: String(input), init: init!, signal: init!.signal as AbortSignal,
      async respond(value, status = 200) { await act(async () => { reply.resolve(Response.json(value, { status })); }); },
      async response(value) { await act(async () => { reply.resolve(value); }); },
      async reject(error) { await act(async () => { reply.reject(error); }); },
    });
    return reply.promise;
  });
  vi.stubGlobal("fetch", fetcher);
  const container = dom.window.document.getElementById("root")!, root = createRoot(container);
  let mounted = true;
  const view = {
    dom, container, requests, fetcher, navigate, replace,
    async panel(owner = wallet, saved = true) { await act(async () => { root.render(createElement(VerifiedIdentityPanel, { wallet: owner, saved })); }); },
    async profile() { await act(async () => { root.render(createElement(PrivateProfileView)); }); },
    status() { return container.querySelector('[role="status"]')?.textContent ?? ""; },
    links() { return [...container.querySelectorAll<HTMLAnchorElement>("section a")]; },
    button(label: string) {
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === label);
      if (!button) throw new Error(`Missing fixture button: ${label}`);
      return button;
    },
    async click(label: string) { await act(async () => { view.button(label).click(); }); },
    async unmount() { if (mounted) { await act(async () => { root.unmount(); }); mounted = false; } },
    async dispose() { await view.unmount(); replace.mockRestore(); dom.window.close(); },
  };
  disposeFixtures.push(() => view.dispose());
  return view;
}
afterEach(async () => {
  try { while (disposeFixtures.length) await disposeFixtures.pop()!(); }
  finally { auth.address = wallet; vi.unstubAllGlobals(); }
});

function profileSnapshot() {
  return { profile: { wallet, displayName: "Fixture owner", handle: "fixture_owner", bio: "", purpose: "",
    links: [{ kind: "github", url: "https://github.com/stored-user" }, { kind: "orcid", url: "https://orcid.org/0000-0002-1825-0097" }],
    createdAt: verifiedAt, updatedAt: verifiedAt },
  activity: { firstSeenAt: null, questions: 0, surfacesUsed: [], topics: [], creatorsPaid: 0,
    scope: "attributed-current-store", network: "eip155:5042" } };
}

describe("rendered verified identity evidence", () => {
  it("consumes a spoofed verified hint without claiming verification for an empty owner snapshot", async () => {
    const view = fixture("https://keryx.cc/me/profile?keep=1&identity=verified#links");
    await view.panel();
    expect(view.status()).toBe("");
    expect(view.button(copy.verifyGithub).disabled).toBe(true);
    expect(view.requests[0].path).toBe("/api/me/profile/identities");
    expect(view.requests[0].init).toMatchObject({ cache: "no-store", headers: { "X-Keryx-Expected-Wallet": wallet } });
    expect(view.requests[0].signal).toBeInstanceOf(AbortSignal);
    expect(view.replace).toHaveBeenCalledExactlyOnceWith({ retained: "fixture-state" }, "", "/me/profile?keep=1#links");
    await view.requests[0].respond(snapshot());
    expect(view.status()).toBe(copy.failed);
    expect(view.container.textContent).not.toContain(copy.verified);
    expect(view.links()).toHaveLength(0);
    expect(view.button(copy.verifyGithub).disabled).toBe(false);
    expect(view.navigate).not.toHaveBeenCalled();
    expect(view.fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    null, { ...snapshot([github]), access_token: "raw-provider-secret" },
    snapshot([{ ...github, wallet: otherWallet }]), snapshot([{ ...github, label: "unsafe/login" }]),
    snapshot([{ ...github, verifiedAt: "not-a-date" }]),
    snapshot([{ ...orcid, externalId: "0000-0002-1825-0098" }]), snapshot([github, github]),
    snapshot([{ ...github, wallet: otherWallet }], otherWallet),
    { wallet, identities: [{ ...github, access_token: "raw-provider-secret" }] },
  ])("refuses malformed or wrong-wallet evidence despite a verified hint: %j", async value => {
    const view = fixture("https://keryx.cc/me/profile?identity=verified"); await view.panel();
    await view.requests[0].respond(value);
    expect(view.status()).toBe(copy.unavailable);
    expect(view.links()).toHaveLength(0);
    expect(view.button(copy.verifyGithub).disabled).toBe(true);
    expect(view.button(copy.verifyOrcid).disabled).toBe(true);
    expect(view.container.textContent).not.toContain(copy.verified);
    expect(view.container.textContent).not.toContain("raw-provider-secret");
    expect(view.dom.window.location.search).toBe("");
    expect(view.fetcher).toHaveBeenCalledOnce();
  });

  it.each(["http", "json", "network"])("contains %s snapshot failure without accepting the hint", async kind => {
    const view = fixture("https://keryx.cc/me/profile?identity=verified"); await view.panel();
    const request = view.requests[0];
    if (kind === "http") await request.respond({ error: "raw-provider-secret" }, 503);
    else if (kind === "json") await request.response(new Response("raw-provider-secret"));
    else await request.reject(new Error("raw-provider-secret"));
    expect(view.status()).toBe(copy.unavailable);
    expect(view.links()).toHaveLength(0);
    expect(view.container.textContent).not.toContain("raw-provider-secret");
    expect(view.container.textContent).not.toContain(copy.verified);
  });

  it.each(["", "verified", "conflict", "failed", "untrusted-provider-detail"])("shows only stored identifiers and original dates with hint '%s'", async hint => {
    const view = fixture(`https://keryx.cc/me/profile${hint ? `?identity=${hint}` : ""}`); await view.panel();
    await view.requests[0].respond(snapshot([github, { ...orcid, label: "" }]));
    expect(view.links().map(link => [link.textContent, link.href])).toEqual([
      ["github: stored-user", "https://github.com/stored-user"], ["orcid: 0000-0002-1825-0097", "https://orcid.org/0000-0002-1825-0097"],
    ]);
    expect([...view.container.querySelectorAll("section span")].map(span => span.textContent)).toEqual([copy.date(verifiedAt), copy.date(verifiedAt)]);
    expect(view.status()).toBe(!hint ? "" : hint === "verified" ? copy.verified : hint === "conflict" ? copy.conflict : copy.failed);
    expect(view.container.textContent).not.toContain("untrusted-provider-detail");
    expect(view.navigate).not.toHaveBeenCalled();
    expect(view.fetcher).toHaveBeenCalledOnce();
  });

  it.each([false, true])("keeps matching typed profile URLs structurally unverified (stored records: %s)", async hasRecords => {
    const view = fixture("https://keryx.cc/me/profile?identity=verified"); await view.profile();
    expect(view.requests[0].path).toBe("/api/me/profile");
    await view.requests[0].respond(profileSnapshot());
    expect(view.requests[1].path).toBe("/api/me/profile/identities");
    await view.requests[1].respond(snapshot(hasRecords ? [github, orcid] : []));
    const typed = [...view.container.querySelectorAll<HTMLAnchorElement>("ul a")];
    expect(typed.map(link => link.href)).toEqual(["https://github.com/stored-user", "https://orcid.org/0000-0002-1825-0097"]);
    for (const link of typed) expect(link.parentElement!.textContent).not.toContain("Verified at");
    expect(view.links()).toHaveLength(hasRecords ? 2 : 0);
    expect(view.container.querySelector("section")!.textContent).toContain(copy.asserted);
    expect(view.status()).toBe(hasRecords ? copy.verified : copy.failed);
    expect(view.fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("rendered owner and saved-profile lifecycle", () => {
  it.each([false, true])("isolates previous-owner records and in-flight snapshots (already loaded: %s)", async loaded => {
    const view = fixture("https://keryx.cc/me/profile?identity=verified"); await view.panel();
    const previous = view.requests[0], body = loaded ? undefined : heldBody();
    if (loaded) await previous.respond(snapshot([github])); else await previous.response(body!.response);
    await view.panel(otherWallet);
    expect(previous.signal.aborted).toBe(true);
    expect(view.links()).toHaveLength(0); expect(view.status()).toBe("");
    expect(view.button(copy.verifyGithub).disabled).toBe(true);
    expect(view.requests[1].init.headers).toEqual({ "X-Keryx-Expected-Wallet": otherWallet });
    await view.requests[1].respond(snapshot([], otherWallet));
    if (body) await body.finish(snapshot([github]));
    expect(view.links()).toHaveLength(0); expect(view.status()).toBe("");
    expect(view.container.textContent).not.toContain("stored-user");
    expect(view.container.textContent).not.toContain(copy.verified);
    expect(view.navigate).not.toHaveBeenCalled();
  });

  it("deletion and recreation remount even the same wallet; unsaved data cannot support a success notice", async () => {
    const view = fixture("https://keryx.cc/me/profile?identity=verified"); await view.panel();
    await view.requests[0].respond(snapshot([github]));
    expect(view.links()).toHaveLength(1);
    view.dom.window.history.replaceState(null, "", "/me/profile?identity=verified");
    await view.panel(wallet, false);
    expect(view.requests[0].signal.aborted).toBe(true);
    expect(view.links()).toHaveLength(0); expect(view.status()).toBe("");
    await view.requests[1].respond(snapshot([github]));
    expect(view.status()).toBe(copy.failed);
    expect(view.container.textContent).toContain(copy.saveFirst);
    expect(view.links()).toHaveLength(0);
    await view.click(copy.verifyGithub); expect(view.fetcher).toHaveBeenCalledTimes(2);
    await view.panel(wallet, true);
    expect(view.requests[1].signal.aborted).toBe(true);
    expect(view.button(copy.verifyGithub).disabled).toBe(true);
    await view.requests[2].respond(snapshot());
    expect(view.links()).toHaveLength(0); expect(view.status()).toBe("");
    expect(view.container.textContent).not.toContain(copy.verified);
  });

  it("actual profile deletion immediately removes its rendered verified records", async () => {
    const view = fixture(); await view.profile(); await view.requests[0].respond(profileSnapshot());
    await view.requests[1].respond(snapshot([github]));
    const confirm = vi.spyOn(view.dom.window, "confirm").mockReturnValue(true);
    try {
      await view.click("Delete profile fields");
      expect(view.requests[2].path).toBe("/api/me/profile"); expect(view.requests[2].init.method).toBe("DELETE");
      await view.requests[2].respond({ deleted: true });
      expect(view.requests[1].signal.aborted).toBe(true);
      expect(view.links()).toHaveLength(0);
      expect(view.button(copy.verifyGithub).disabled).toBe(true);
      await view.requests[3].respond(snapshot());
      expect(view.links()).toHaveLength(0);
      expect(view.container.textContent).toContain(copy.saveFirst);
    } finally { confirm.mockRestore(); }
  });

  it.each(["start", "unlink"] as const)("ignores aborted late %s bodies after an owner change", async action => {
    const view = fixture(); await view.panel(); await view.requests[0].respond(snapshot([github]));
    await view.click(action === "start" ? copy.verifyGithub : copy.unlink);
    const operation = view.requests[1], body = heldBody(); await operation.response(body.response);
    expect(operation.init).toMatchObject({ method: action === "start" ? "POST" : "DELETE", headers: { "X-Keryx-Expected-Wallet": wallet } });
    expect(operation.init.body).toBeUndefined();
    await view.panel(otherWallet);
    expect(operation.signal.aborted).toBe(true);
    await view.requests[2].respond(snapshot([{ ...github, wallet: otherWallet, label: "new-owner" }], otherWallet));
    await body.finish(action === "start" ? { authorizationUrl: authorizationUrls.github } : { unlinked: true });
    expect(view.links().map(link => link.textContent)).toEqual(["github: new-owner"]);
    expect(view.status()).toBe(""); expect(view.navigate).not.toHaveBeenCalled();
    expect(view.button(copy.verifyGithub).disabled).toBe(false);
  });

  it.each(["start", "unlink"] as const)("ignores a late %s transport failure after saved-profile deletion", async action => {
    const view = fixture(); await view.panel(); await view.requests[0].respond(snapshot([github]));
    await view.click(action === "start" ? copy.verifyGithub : copy.unlink);
    const operation = view.requests[1]; await view.panel(wallet, false);
    expect(operation.signal.aborted).toBe(true); await view.requests[2].respond(snapshot());
    await operation.reject(new Error("raw-provider-secret"));
    expect(view.status()).toBe(""); expect(view.links()).toHaveLength(0);
    expect(view.container.textContent).not.toContain("raw-provider-secret");
    expect(view.navigate).not.toHaveBeenCalled();
  });

  it("unmount aborts pending read and start bodies without late navigation", async () => {
    const view = fixture(); await view.panel(); await view.requests[0].respond(snapshot());
    await view.click(copy.verifyGithub); const body = heldBody(); await view.requests[1].response(body.response);
    await view.unmount(); expect(view.requests.every(request => request.signal.aborted)).toBe(true);
    await body.finish({ authorizationUrl: authorizationUrls.github });
    expect(view.container.textContent).toBe(""); expect(view.navigate).not.toHaveBeenCalled();
  });
});

describe("rendered identity actions and bounded failures", () => {
  it("requires the exact unlink acknowledgement, removes only that provider and blocks duplicate clicks", async () => {
    const view = fixture(); await view.panel(); await view.requests[0].respond(snapshot([github, orcid]));
    await view.click(copy.unlink);
    expect(view.requests[1].path).toBe("/api/me/profile/identities/github");
    expect(view.requests[1].init.method).toBe("DELETE"); expect(view.requests[1].init.body).toBeUndefined();
    expect([...view.container.querySelectorAll<HTMLButtonElement>("button")].every(button => button.disabled)).toBe(true);
    await view.click(copy.unlink); expect(view.fetcher).toHaveBeenCalledTimes(2);
    await view.requests[1].respond({ unlinked: true });
    expect(view.status()).toBe(copy.unlinked);
    expect(view.links().map(link => link.textContent)).toEqual(["orcid: Stored Researcher"]);
    expect(view.container.textContent).toContain(copy.date(verifiedAt));
    expect(view.button(copy.verifyGithub).disabled).toBe(false); expect(view.navigate).not.toHaveBeenCalled();
    expect(view.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([null, true, [], {}, { unlinked: false }, { unlinked: "true" },
    { unlinked: true, provider: "github" }, { unlinked: true, error: "raw-provider-secret" },
  ].map(value => ({ value })))("keeps the stored record on inexact unlink acknowledgement %j", async ({ value }) => {
    const view = fixture(); await view.panel(); await view.requests[0].respond(snapshot([github]));
    await view.click(copy.unlink); await view.requests[1].respond(value);
    expect(view.status()).toBe(copy.invalid);
    expect(view.links().map(link => link.textContent)).toEqual(["github: stored-user"]);
    expect(view.container.textContent).not.toContain("raw-provider-secret");
    expect(view.button(copy.unlink).disabled).toBe(false); expect(view.navigate).not.toHaveBeenCalled();
  });

  for (const action of ["start", "unlink"] as const) it.each(["network", "json", "http", "owner"])("uses fixed copy for " + action + " %s failures", async kind => {
    const view = fixture(); await view.panel(); await view.requests[0].respond(snapshot([github]));
    await view.click(action === "start" ? copy.verifyGithub : copy.unlink);
    const request = view.requests[1], raw = `raw-provider-secret:${"x".repeat(8192)}`;
    if (kind === "network") await request.reject(new Error(raw));
    else if (kind === "json") await request.response(new Response(raw));
    else await request.respond({ error: kind === "owner" ? "profile_owner_changed" : raw, message: raw }, kind === "owner" ? 409 : 503);
    expect(view.status()).toBe(kind === "owner" ? copy.changed : kind === "http" ? copy.unavailable : copy.failed);
    expect(view.status().length).toBeLessThan(160);
    expect(view.container.textContent).not.toContain("raw-provider-secret");
    expect(view.links().map(link => link.textContent)).toEqual(["github: stored-user"]);
    expect(view.button(copy.verifyGithub).disabled).toBe(false); expect(view.navigate).not.toHaveBeenCalled();
    expect(view.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    undefined, null, "not a URL raw-provider-secret", "http://github.com/login/oauth/authorize",
    "https://arbitrary.invalid/login/oauth/authorize", "https://github.com.arbitrary.invalid/login/oauth/authorize",
    "https://user:raw-provider-secret@github.com/login/oauth/authorize", "https://github.com:444/login/oauth/authorize",
    "https://github.com/login/oauth/authorize#raw-provider-secret", "https://github.com/other",
    authorizationUrls.orcid,
  ])("refuses an arbitrary or malformed GitHub start destination %s", async authorizationUrl => {
    const view = fixture(); await view.panel(); await view.requests[0].respond(snapshot());
    await view.click(copy.verifyGithub); await view.requests[1].respond({ authorizationUrl });
    expect(view.status()).toBe(copy.invalid); expect(view.navigate).not.toHaveBeenCalled();
    expect(view.container.textContent).not.toContain("raw-provider-secret");
    expect(view.links()).toHaveLength(0); expect(view.button(copy.verifyGithub).disabled).toBe(false);
  });

  it.each(["github", "orcid"] as const)("preserves eligible ordinary %s start, then displays only the callback's stored record", async provider => {
    const view = fixture(); await view.panel(); await view.requests[0].respond(snapshot());
    await view.click(provider === "github" ? copy.verifyGithub : copy.verifyOrcid);
    expect(view.requests[1].path).toBe(`/api/me/profile/identities/${provider}/start`);
    expect(view.requests[1].init.method).toBe("POST"); expect(view.requests[1].init.body).toBeUndefined();
    await view.requests[1].respond({ authorizationUrl: authorizationUrls[provider] });
    expect(view.navigate).toHaveBeenCalledExactlyOnceWith(authorizationUrls[provider]);
    expect(view.links()).toHaveLength(0); expect(view.status()).toBe("");
    await view.unmount();
    const returned = fixture("https://keryx.cc/me/profile?identity=verified"); await returned.panel();
    const record = provider === "github" ? github : orcid;
    await returned.requests[0].respond(snapshot([record]));
    expect(returned.status()).toBe(copy.verified);
    expect(returned.links().map(link => link.textContent)).toEqual([`${provider}: ${record.label}`]);
    expect(returned.container.textContent).toContain(copy.date(verifiedAt));
    expect(returned.navigate).not.toHaveBeenCalled();
  });
});
