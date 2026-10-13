// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrivateProfileView } from "@/app/me/profile/private-profile-view";
import type { PrivateProfileInput, PrivateProfileRecord, PrivateProfileSnapshot } from "./private-profile";

// Only authentication and HTTP are controlled; render the actual editor and identity panel.
const auth = vi.hoisted(() => ({ session: undefined as { address: string } | null | undefined }));
vi.mock("@/lib/hooks/use-siwe-auth", () => ({ useSiweAuth: () => ({ session: auth.session }) }));
vi.mock("next/link", () => ({ default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props) }));

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const fields: PrivateProfileInput = { displayName: "Alice private", handle: "alice_reader", bio: "Reader", purpose: "Papers", links: [{ kind: "github", url: "https://github.com/alice" }] };
const record = (wallet = alice, input = fields): PrivateProfileRecord => ({ ...input, wallet, createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" });
const snapshot = (profile: PrivateProfileRecord | null = record()): PrivateProfileSnapshot => ({ profile,
  activity: { firstSeenAt: null, questions: 3, surfacesUsed: ["web"], topics: ["biology"], creatorsPaid: 1, scope: "attributed-current-store", network: "eip155:5042" } });
const confirmation = "Delete your private profile fields and links? Research and payment history will remain.";
let root: Root | undefined, container: HTMLDivElement;

function pendingResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let respond: (method: string, init: RequestInit) => Response | Promise<Response> = () => Response.json(snapshot());
  const fetcher = vi.fn<typeof fetch>(async (path, init = {}) => {
    const expected = new Headers(init.headers).get("x-keryx-expected-wallet");
    if (String(path) === "/api/me/profile/identities") return Response.json({ wallet: expected, identities: [] });
    if (String(path) !== "/api/me/profile") throw new Error("Unexpected fixture request");
    return respond(init.method ?? "GET", init);
  });
  vi.stubGlobal("fetch", fetcher);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  return { fetcher, confirm, respond: (handler: typeof respond) => { respond = handler; },
    calls: () => fetcher.mock.calls.filter(([path]) => String(path) === "/api/me/profile") };
}
async function render(session: typeof auth.session = auth.session) {
  auth.session = session;
  await act(async () => { root ??= createRoot(container); root.render(React.createElement(PrivateProfileView)); });
}
function input(label: string) {
  const element = Array.from(container.querySelectorAll("label")).find(item => item.textContent === label)?.querySelector("input");
  expect(element, `Rendered field ${label}`).toBeTruthy(); return element!;
}
function button(label: string) {
  const element = Array.from(container.querySelectorAll("button")).find(item => item.textContent === label);
  expect(element, `Rendered action ${label}`).toBeTruthy(); return element!;
}
async function edit(label: string, value: string) {
  await act(async () => {
    const element = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
async function click(label: string) { await act(async () => { button(label).click(); }); }
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  auth.session = { address: alice }; container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each([undefined, null])("checking or signed-out sessions render no private editor and make no requests (%s)", async session => {
  const f = fixture(); auth.session = session; await render();
  expect(f.fetcher).not.toHaveBeenCalled(); expect(container.querySelector("form")).toBeNull();
  if (session === undefined) expect(container.querySelector('[role="status"]')?.textContent).toBe("Checking your sign-in…");
  else expect(container.querySelector("a")?.getAttribute("href")).toBe("/connect");
});

it("a pending initial read reports loading, withholds fields and cannot retry until it settles", async () => {
  const f = fixture(), pending = pendingResponse(); f.respond(() => pending.promise); await render();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading My private profile…");
  expect(container.textContent).not.toContain("after this deployment enables");
  expect(container.querySelector("input")).toBeNull(); expect(button("Retry").disabled).toBe(true);
  await click("Retry"); expect(f.calls()).toHaveLength(1);
  expect(f.calls()[0][1]).toMatchObject({ cache: "no-store", headers: { "X-Keryx-Expected-Wallet": alice } });
  await act(async () => pending.resolve(Response.json(snapshot(null))));
  expect(input("Display name").value).toBe(""); expect(button("Delete profile fields").disabled).toBe(true);
});

it.each([401, 409, 503])("initial read HTTP %i exposes no private response fields and retries only on the owner's action", async status => {
  const f = fixture(); f.respond(() => Response.json({ message: "Synthetic read refusal", profile: record(), activity: snapshot().activity }, { status })); await render();
  expect(container.querySelector("input")).toBeNull(); expect(container.textContent).not.toContain(fields.displayName);
  expect(container.textContent).toContain("Synthetic read refusal"); expect(f.calls()).toHaveLength(1);
  const pending = pendingResponse(); f.respond(() => pending.promise); await click("Retry");
  expect(f.calls()).toHaveLength(2); expect(button("Retry").disabled).toBe(true); expect(container.textContent).not.toContain("Synthetic read refusal");
  await click("Retry"); expect(f.calls()).toHaveLength(2);
  await act(async () => pending.resolve(Response.json(snapshot())));
  expect(input("Display name").value).toBe(fields.displayName); expect(f.calls()).toHaveLength(2);
});

it.each([
  { name: "wrong wallet", value: snapshot(record(bob)) }, { name: "extra private fields", value: { ...snapshot(), secret: "never import" } },
  { name: "overlong text", value: snapshot(record(alice, { ...fields, displayName: "x".repeat(81) })) },
  { name: "missing activity", value: { profile: record() } }, { name: "null", value: null }, { name: "array", value: [] },
])("malformed initial snapshot ($name) never opens the editor", async ({ value }) => {
  const f = fixture(); f.respond(() => Response.json(value)); await render();
  expect(container.querySelector("input")).toBeNull(); expect(button("Retry").disabled).toBe(false);
  expect(container.textContent).not.toContain(fields.displayName); expect(container.textContent).not.toContain("never import"); expect(f.calls()).toHaveLength(1);
});

it("a network read failure stays private and a manual retry can recover", async () => {
  const f = fixture(); f.respond(() => { throw new Error("Synthetic network refusal"); }); await render();
  expect(container.querySelector("input")).toBeNull(); expect(container.textContent).toContain("Synthetic network refusal"); expect(f.calls()).toHaveLength(1);
  f.respond(() => Response.json(snapshot())); await click("Retry");
  expect(input("Display name").value).toBe(fields.displayName); expect(f.calls()).toHaveLength(2);
});

it("the real form creates and edits bounded textual fields and renders saved links as text", async () => {
  const f = fixture(); let saved: PrivateProfileRecord | null = null;
  f.respond((method, init) => {
    if (method === "GET") return Response.json(snapshot(saved));
    expect(method).toBe("PUT"); saved = record(alice, JSON.parse(String(init.body)) as PrivateProfileInput); return Response.json({ profile: saved });
  });
  await render();
  for (const [label, maximum] of [["Display name", 80], ["Handle", 32], ["Who I am", 160], ["What brings me to Keryx", 160], ["github", 512]] as const)
    expect(input(label).maxLength).toBe(maximum);
  const text = '<img data-injection onerror="alert(1)">';
  await edit("Display name", text); await edit("Handle", "Alice_Reader"); await edit("Who I am", "Reader");
  await edit("What brings me to Keryx", "Papers"); await edit("github", fields.links[0].url); await submit();
  expect(container.textContent).toContain("Private profile saved."); expect(input("Display name").value).toBe(text);
  expect(container.querySelector("img, [data-injection]")).toBeNull();
  const link = container.querySelector<HTMLAnchorElement>('a[href="https://github.com/alice"]')!;
  expect(link.textContent).toBe("github: https://github.com/alice"); expect(link.target).toBe("_blank"); expect(link.rel).toBe("noopener noreferrer nofollow");
  const put = f.calls()[1][1]!;
  expect(put).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/json", "X-Keryx-Expected-Wallet": alice } });
  expect(JSON.parse(String(put.body))).toEqual({ displayName: text, handle: "alice_reader", bio: "Reader", purpose: "Papers", links: fields.links });
  await edit("Who I am", "Updated reader"); await submit(); expect(f.calls()).toHaveLength(3);
  expect(JSON.parse(String(f.calls()[2][1]?.body)).bio).toBe("Updated reader");
});

it("HTML-looking activity remains text and a pending save keeps edits locked until acknowledgement", async () => {
  const f = fixture(), pending = pendingResponse(), text = "<img data-topic-injection>";
  f.respond(() => Response.json({ ...snapshot(), activity: { ...snapshot().activity, topics: [text] } })); await render();
  expect(container.textContent).toContain(text); expect(container.querySelector("img, [data-topic-injection]")).toBeNull();
  await edit("Display name", "Pending draft"); f.respond(() => pending.promise); await submit();
  expect(input("Display name").value).toBe("Pending draft"); expect(input("Display name").disabled).toBe(true);
  expect(button("Saving…").disabled).toBe(true); expect(button("Delete profile fields").disabled).toBe(true);
  expect(container.textContent).not.toContain("Private profile saved.");
  await act(async () => pending.resolve(Response.json({ profile: record(alice, { ...fields, displayName: "Pending draft" }) })));
  expect(input("Display name").value).toBe("Pending draft"); expect(button("Save private profile").disabled).toBe(false); expect(f.calls()).toHaveLength(2);
});

it.each(["admin", "KERYX", "ab", "reader-name"])("invalid or reserved handle %s remains editable without a write", async handle => {
  const f = fixture(); await render(); await edit("Handle", handle); await submit();
  expect(f.calls()).toHaveLength(1); expect(input("Handle").value).toBe(handle); expect(button("Save private profile").disabled).toBe(false);
  expect(container.textContent).not.toContain("Private profile saved.");
});

it.each([
  { name: "handle collision", response: () => Response.json({ message: "That handle is unavailable." }, { status: 409 }) },
  { name: "unavailable store", response: () => Response.json({ message: "Synthetic save refusal" }, { status: 503 }) },
  { name: "wrong wallet", response: () => Response.json({ profile: record(bob, { ...fields, displayName: "Foreign response" }) }) },
  { name: "extra envelope fields", response: () => Response.json({ profile: record(), deleted: true }) },
  { name: "missing profile", response: () => Response.json({}) }, { name: "invalid JSON", response: () => new Response("not JSON") },
])("save failure ($name) retains edits and saved links without automatic retry", async ({ response }) => {
  const f = fixture(); await render(); await edit("Display name", "Retain this draft"); await edit("Who I am", "Unsaved bio");
  f.respond(response); await submit();
  expect(input("Display name").value).toBe("Retain this draft"); expect(input("Who I am").value).toBe("Unsaved bio");
  expect(container.querySelector('a[href="https://github.com/alice"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Foreign response"); expect(container.textContent).not.toContain("Private profile saved.");
  expect(container.querySelector('[role="status"]')?.textContent).toBeTruthy(); expect(button("Save private profile").disabled).toBe(false); expect(f.calls()).toHaveLength(2);
});

it("delete requires the unchanged confirmation, disables editing while pending and clears only after exact acknowledgement", async () => {
  const f = fixture(), pending = pendingResponse(); await render(); await edit("Display name", "Retain this draft");
  f.confirm.mockReturnValueOnce(false); await click("Delete profile fields"); expect(f.confirm).toHaveBeenCalledWith(confirmation); expect(f.calls()).toHaveLength(1);
  f.respond(() => pending.promise); await click("Delete profile fields");
  expect(input("Display name").disabled).toBe(true); expect(button("Delete profile fields").disabled).toBe(true); expect(input("Display name").value).toBe("Retain this draft");
  expect(f.calls()[1][1]).toMatchObject({ method: "DELETE", headers: { "X-Keryx-Expected-Wallet": alice } }); expect(f.calls()[1][1]?.body).toBeUndefined();
  await act(async () => pending.resolve(Response.json({ deleted: true })));
  expect(input("Display name").value).toBe(""); expect(button("Delete profile fields").disabled).toBe(true);
  expect(container.querySelector('a[href="https://github.com/alice"]')).toBeNull(); expect(container.textContent).toContain("Profile fields deleted. Your research and payment history are retained.");
  expect(container.textContent).toContain("Attributed dispatches: 3"); expect(f.calls()).toHaveLength(2);
});

it.each([
  { name: "HTTP refusal", response: () => Response.json({ message: "Synthetic delete refusal" }, { status: 503 }) },
  { name: "false acknowledgement", response: () => Response.json({ deleted: false }) }, { name: "missing acknowledgement", response: () => Response.json({}) },
  { name: "extra envelope fields", response: () => Response.json({ deleted: true, profile: record(bob) }) },
  { name: "null", response: () => Response.json(null) }, { name: "array", response: () => Response.json([]) }, { name: "invalid JSON", response: () => new Response("not JSON") },
])("delete failure ($name) keeps private fields and links and does not claim deletion", async ({ response }) => {
  const f = fixture(); await render(); await edit("Display name", "Retain this draft"); f.respond(response); await click("Delete profile fields");
  expect(input("Display name").value).toBe("Retain this draft"); expect(container.querySelector('a[href="https://github.com/alice"]')).not.toBeNull();
  expect(button("Delete profile fields").disabled).toBe(false); expect(container.textContent).not.toContain("Profile fields deleted."); expect(f.calls()).toHaveLength(2);
});

it.each(["GET", "PUT", "DELETE"] as const)("late %s callback after wallet change or sign-out cannot import fields or clear the new editor", async method => {
  for (const nextOwner of [bob, null]) {
    const f = fixture(), pending = pendingResponse();
    f.respond((action, init) => {
      const expected = new Headers(init.headers).get("x-keryx-expected-wallet");
      if (expected === alice && action === method) return pending.promise;
      return Response.json(snapshot(record(expected!, expected === bob ? { ...fields, displayName: "Bob private", handle: "bob_reader", links: [] } : fields)));
    });
    await render({ address: alice });
    if (method !== "GET") { await edit("Display name", "Alice draft"); if (method === "PUT") await submit(); else await click("Delete profile fields"); }
    const signal = f.calls().at(-1)?.[1]?.signal; expect(signal?.aborted).toBe(false);
    await render(nextOwner ? { address: nextOwner } : null); expect(signal?.aborted).toBe(true);
    const stale = record(alice, { ...fields, displayName: "Stale Alice callback" });
    await act(async () => pending.resolve(Response.json(method === "GET" ? snapshot(stale) : method === "PUT" ? { profile: stale } : { deleted: true })));
    if (nextOwner) { expect(input("Display name").value).toBe("Bob private"); expect(f.calls().at(-1)?.[1]?.headers).toMatchObject({ "X-Keryx-Expected-Wallet": bob }); }
    else expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("Stale Alice callback"); expect(container.textContent).not.toContain("Private profile saved.");
    expect(container.textContent).not.toContain("Profile fields deleted."); expect(container.querySelector('a[href="https://github.com/alice"]')).toBeNull();
    await act(async () => root!.unmount()); root = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it.each(["GET", "PUT", "DELETE"] as const)("an aborted %s response is refused even when the HTTP fixture returns late", async method => {
  const f = fixture(), pending = pendingResponse(), deadline = new AbortController();
  if (method !== "GET") { await render(); await edit("Display name", "Retain this draft"); }
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal); f.respond(() => pending.promise);
  if (method === "GET") await render(); else if (method === "PUT") await submit(); else await click("Delete profile fields");
  await act(async () => {
    deadline.abort();
    pending.resolve(Response.json(method === "GET" ? snapshot() : method === "PUT" ? { profile: record() } : { deleted: true }));
  });
  if (method === "GET") { expect(container.querySelector("input")).toBeNull(); expect(button("Retry").disabled).toBe(false); }
  else { expect(input("Display name").value).toBe("Retain this draft"); expect(button("Save private profile").disabled).toBe(false); }
  expect(container.textContent).not.toContain("Private profile saved."); expect(container.textContent).not.toContain("Profile fields deleted.");
  expect(f.calls()).toHaveLength(method === "GET" ? 1 : 2);
});
