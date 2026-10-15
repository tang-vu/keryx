// @vitest-environment jsdom
// SOURCE ONLY / UNRUN until the parent executes this file explicitly. These are
// actual React DOM controls with synthetic HTTP, not native authority evidence.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerRunAssignmentInbox } from "@/components/keryx/owner-run-assignment-inbox";
import { ownerRunAssignmentMessages as copy } from "@/locales/en/owner-run-assignments";
import type { Manifest, Receipt, Recipient } from "./contracts";
import type { AssignmentInbox, InboxItem } from "./projection";

// Only existing authentication and HTTP/auth-channel transport are controlled.
// The component, Next Link, projection/schema, formatter and English copy are real.
type Session = { address: string; role: string } | null | undefined;
const auth = vi.hoisted(() => ({ session: undefined as Session }));
vi.mock("@/lib/hooks/use-siwe-auth", () => ({ useSiweAuth: () => ({ session: auth.session }) }));

const wallet = `0x${"a".repeat(40)}`, otherWallet = `0x${"b".repeat(40)}`;
const recipient: Recipient = { accountId: `acct_${"c".repeat(64)}`, accountCreatedAt: 1000,
  wallet, memberGeneration: "d".repeat(64) };
const replacement: Recipient = { accountId: `acct_${"e".repeat(64)}`, accountCreatedAt: 2000,
  wallet, memberGeneration: "f".repeat(64) };
const assigned: InboxItem = { assignmentId: "11111111-1111-4111-8111-111111111111", revision: 1,
  status: "assigned-by-owner", assignedAt: 1_790_812_800_000, confirmedAt: null, admissionExpiresAt: 1_900_000_000_000,
  effective: true, runId: "synthetic-assigned-original", network: "eip155:5042002", attribution: "assigned-by-owner" };
const claimed: InboxItem = { ...assigned, assignmentId: "22222222-2222-4222-8222-222222222222", revision: 2,
  status: "claimed", confirmedAt: assigned.assignedAt + 1000,
  runId: "synthetic-claimed-original", network: "eip155:5042", attribution: "claimed-from-owner-assignment" };
const manifest: Manifest = { version: 1,
  binding: { network: "eip155:5042002", origin: "https://owner269.invalid", storageDigest: "1".repeat(64) },
  recipient, basis: { code: "documented-recipient-request", reference: "synthetic-readonly-dom-only" },
  scope: "association-history-and-confirmation", admissionExpiresAt: assigned.admissionExpiresAt,
  members: [{ assignmentId: assigned.assignmentId, runId: assigned.runId!, originalSha256: "2".repeat(64),
    completedAt: "2026-10-01T00:00:00.000Z" }] };
function inbox(history: InboxItem[] = [assigned, claimed], current = recipient): AssignmentInbox {
  return { version: 1, kind: "owner-assignment-inbox", recipient: current, history,
    profile: { assignedByOwner: history.filter(row => row.effective && row.attribution === "assigned-by-owner").length,
      claimedFromOwnerAssignment: history.filter(row => row.effective && row.attribution === "claimed-from-owner-assignment").length } };
}
function suppressed(row: InboxItem): InboxItem {
  return { assignmentId: row.assignmentId, revision: row.revision, status: row.status,
    assignedAt: row.assignedAt, confirmedAt: row.confirmedAt, admissionExpiresAt: row.admissionExpiresAt, effective: false };
}
function receipt(action: Receipt["action"], requestId: string): Receipt {
  return { version: 1, requestId, inputDigest: "3".repeat(64), action, committedAt: assigned.assignedAt + 2000,
    results: [], meaning: "historical-committed-result-not-current-authority" };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
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
type Boundary = "keryx:auth" | "focus" | "BroadcastChannel";
type Call = { init: RequestInit; signal: AbortSignal; result: ReturnType<typeof deferred<Response>> };
let root: Root | undefined, container: HTMLDivElement, calls: Call[], finishBodies: Array<() => void>;
beforeEach(() => {
  auth.session = { address: wallet, role: "asker" }; calls = []; finishBodies = []; AuthChannel.instances = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", AuthChannel);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    expect(String(input)).toBe("/api/me/run-assignments");
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    expect(init.signal).toBeDefined(); expect(new Headers(init.headers).has("authorization")).toBe(false);
    const result = deferred<Response>(); calls.push({ init, signal: init.signal as AbortSignal, result }); return result.promise;
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await unmount();
  // Drain synthetic IO even on assertion failure; never leave body/timer work.
  await act(async () => { for (const call of calls) call.result.resolve(Response.json({}, { status: 503 }));
    for (const finish of finishBodies) finish(); });
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(mode: boolean | "default" = true) {
  await act(async () => { root!.render(createElement<{ readOnlyView?: boolean }>(OwnerRunAssignmentInbox, mode === "default" ? {} : { readOnlyView: mode })); });
}
async function unmount() { if (root) { await act(async () => root!.unmount()); root = undefined; } }
async function reply(index: number, value: unknown, status = 200) {
  await act(async () => { calls[index].result.resolve(Response.json(value, { status })); });
}
async function reject(index: number) {
  await act(async () => { calls[index].result.reject(new Error("Synthetic unknown HTTP outcome")); });
}
async function holdBody(index: number) {
  let controller!: ReadableStreamDefaultController<Uint8Array>, finished = false;
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }),
    { headers: { "Content-Type": "application/json" } });
  const json = vi.spyOn(response, "json"); // Observe real body parsing; do not mock it or obey fetch abort for it.
  const finish = (value: unknown) => { if (!finished) { finished = true;
    controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); } };
  finishBodies.push(() => finish({}));
  await act(async () => { calls[index].result.resolve(response); }); expect(json).toHaveBeenCalledOnce();
  return { async finish(value: unknown) { await act(async () => { finish(value); }); } };
}
function button(text: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text);
  if (!found) throw new Error(`Missing real assignment button: ${text}`);
  return found;
}
async function click(text: string) { await act(async () => { button(text).click(); }); }
async function invalidate(boundary: Boundary) {
  await act(async () => {
    if (boundary === "BroadcastChannel") { const peer = new AuthChannel("keryx-auth-v1"); peer.postMessage("changed"); peer.close(); }
    else window.dispatchEvent(boundary === "focus" ? new Event("focus") : new CustomEvent("keryx:auth", { detail: "changed" }));
  });
}
const status = () => container.querySelector('[role="status"]')?.textContent;
const counts = () => container.querySelector(`[aria-label="${copy.profile}"]`);
function expectCounts(assignedCount: number, claimedCount: number) {
  expect([...counts()!.querySelectorAll("p")].map(node => node.textContent))
    .toEqual([`${copy.assignedCount}: ${assignedCount}`, `${copy.claimedCount}: ${claimedCount}`]);
}
function noMutationControls() {
  expect(container.querySelector("form, input, textarea")).toBeNull();
  expect([...container.querySelectorAll("button")].map(node => node.textContent)).toEqual([copy.refresh]);
  for (const text of [copy.consent, copy.consentManifest, copy.acknowledgement, copy.financialAcknowledgement,
    copy.recovery, copy.resolve, copy.confirm, copy.reject, copy.withdraw, copy.proposalSummary, copy.unknown])
    expect(container.textContent).not.toContain(text);
}
function noPosts(from = 0) {
  for (const call of calls.slice(from)) { expect(call.init.method).toBe("GET"); expect(call.init.body).toBeUndefined();
    expect(new Headers(call.init.headers).has("content-type")).toBe(false); }
}
function cleared() {
  expect(counts()).toBeNull(); expect(container.querySelector("li, form, input, textarea")).toBeNull();
  for (const text of [assigned.runId!, claimed.runId!, assigned.assignmentId, claimed.assignmentId, recipient.accountId,
    recipient.memberGeneration, "synthetic-stale-body", "synthetic-current-body"])
    expect(container.textContent).not.toContain(text);
}
async function ready(mode: boolean | "default" = true, value = inbox()) { await render(mode); await reply(0, value); }
async function prepareConsent() {
  const field = container.querySelector<HTMLTextAreaElement>("form textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, JSON.stringify(manifest));
    field.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) checkbox.click(); });
  expect(container.querySelector("form")!.checkValidity()).toBe(true);
}
// Retain the actual React-bound DOM handler to model queued invocation after
// detach, in addition to clicking the old DOM. This does not mock the editor.
function retainHandler(node: Element, name: "onClick" | "onSubmit") {
  const propsKey = Object.keys(node).find(key => key.startsWith("__reactProps$"));
  expect(propsKey).toBeDefined();
  const handler: unknown = Reflect.get(node, propsKey!)[name]; expect(typeof handler).toBe("function");
  return handler as (event: Event) => void;
}

describe("owner269 read-only association DOM (SOURCE ONLY / UNRUN)", () => {
  it.each(["checking", "anonymous"] as const)("does no private IO while %s", async state => {
    auth.session = state === "checking" ? undefined : null; await render();
    if (state === "checking") expect(status()).toBe(copy.checking);
    else expect(container.querySelector('a[href="/connect"]')?.textContent).toBe(copy.signIn);
    await invalidate("keryx:auth"); await invalidate("focus"); await invalidate("BroadcastChannel");
    expect(calls).toHaveLength(0); expect(container.querySelector("form, input, textarea")).toBeNull();
  });

  it("renders effective assigned and claimed IDs, original networks and separate counts using the strict existing GET", async () => {
    auth.session = { address: wallet.toUpperCase(), role: "owner" }; await ready();
    expect(calls).toHaveLength(1); expect(calls[0].signal.aborted).toBe(false);
    expect(new Headers(calls[0].init.headers).get("x-keryx-expected-wallet")).toBe(wallet);
    expectCounts(1, 1);
    const rows = [...container.querySelectorAll("li")]; expect(rows).toHaveLength(2);
    for (const [index, row] of [assigned, claimed].entries()) {
      expect(rows[index].querySelector("h3")?.textContent).toBe(index ? copy.claimed : copy.assigned);
      expect(rows[index].querySelector("code")?.textContent).toBe(row.assignmentId);
      expect(rows[index].textContent).toContain(`${row.runId} · ${row.network}`);
    }
    expect(container.querySelector("h2")?.textContent).toBe(copy.title);
    expect(container.textContent).toContain(copy.scope);
    expect(container.querySelector('a[href="/me/run-assignments"]')?.textContent).toBe(copy.menu);
    expect(container.querySelectorAll("a")).toHaveLength(1); // No run/report/publication links.
    noMutationControls(); noPosts();
    await click(copy.refresh); await reply(1, inbox([]));
    expectCounts(0, 0); expect(container.textContent).toContain(copy.empty); noMutationControls(); noPosts();
  });

  it("renders suppressed associations without effective IDs/networks, positive claim labels or assignment counts", async () => {
    await ready(true, inbox([suppressed(assigned), suppressed(claimed)]));
    expectCounts(0, 0); expect(container.querySelectorAll("li")).toHaveLength(2);
    expect([...container.querySelectorAll("li h3")].map(node => node.textContent)).toEqual([copy.suppressed, copy.suppressed]);
    for (const row of [assigned, claimed]) {
      expect(container.textContent).toContain(row.assignmentId);
      expect(container.textContent).not.toContain(row.runId!); expect(container.textContent).not.toContain(row.network!);
    }
    noMutationControls(); noPosts();
  });

  it.each([
    ["unknown envelope field", { ...inbox(), question: "synthetic-private-question" }],
    ["unknown history field", { ...inbox(), history: [{ ...assigned, question: "synthetic-private-question" }] }],
    ["unknown recipient field", { ...inbox(), recipient: { ...recipient, inheritedOwner: true } }],
    ["unknown profile field", { ...inbox(), profile: { ...inbox().profile, paidRuns: 9 } }],
    ["different wallet", inbox(undefined, { ...recipient, wallet: otherWallet })],
    ["invalid account ID", inbox(undefined, { ...recipient, accountId: "foreign-account" })],
    ["invalid account creation time", inbox(undefined, { ...recipient, accountCreatedAt: -1 })],
    ["invalid member generation", inbox(undefined, { ...recipient, memberGeneration: "foreign-generation" })],
    ["count mismatch", { ...inbox(), profile: { assignedByOwner: 2, claimedFromOwnerAssignment: 1 } }],
    ["partial effective tuple", { ...inbox([assigned]), history: [{ ...assigned, network: undefined }] }],
    ["leaked suppressed run", { ...inbox([]), history: [{ ...suppressed(assigned), runId: assigned.runId }] }],
    ["wrong attribution discriminator", { ...inbox([assigned]), history: [{ ...assigned, attribution: "claimed-from-owner-assignment" }] }],
    ["more than 25 history rows", inbox(Array.from({ length: 26 }, () => assigned))],
  ])("refuses %s without displaying private data or posting", async (_name, value) => {
    await render(); await reply(0, value); expect(status()).toBe(copy.unavailable); cleared();
    expect(container.textContent).not.toContain("synthetic-private-question"); noMutationControls(); noPosts(); expect(calls).toHaveLength(1);
  });

  it.each([401, 409, 503])("refuses even valid-looking data with HTTP %s", async code => {
    await render(); await reply(0, inbox(), code); cleared(); expect(status()).toBe(copy.unavailable); noMutationControls(); noPosts();
  });

  it("keeps parse and transport failures unavailable and only recovers through another explicit GET", async () => {
    await render(); await act(async () => { calls[0].result.resolve(new Response("not-json")); });
    cleared(); expect(status()).toBe(copy.unavailable); await click(copy.refresh); await reject(1);
    cleared(); expect(status()).toBe(copy.unavailable); await click(copy.refresh); await reply(2, inbox());
    expectCounts(1, 1); noMutationControls(); noPosts(); expect(calls).toHaveLength(3);
  });

  it.each<Boundary>(["keryx:auth", "focus", "BroadcastChannel"])("erases private rows on %s without automatic IO, then requires fresh GET", async boundary => {
    await ready(); await invalidate(boundary); cleared(); expect(status()).toBe(copy.changed); expect(calls).toHaveLength(1);
    await render(); cleared(); expect(calls).toHaveLength(1);
    await click(copy.refresh); await reply(1, inbox([claimed])); expectCounts(0, 1); noMutationControls(); noPosts();
  });

  it.each<Boundary>(["keryx:auth", "focus", "BroadcastChannel"])("aborts a held GET on %s and rejects its late real body without unlocking the current GET", async boundary => {
    await ready(); await click(copy.refresh); const oldBody = await holdBody(1);
    await invalidate(boundary); expect(calls[1].signal.aborted).toBe(true); cleared();
    await click(copy.refresh); const currentBody = await holdBody(2);
    await oldBody.finish(inbox([{ ...assigned, runId: "synthetic-stale-body" }])); cleared();
    expect(button(copy.refresh).disabled).toBe(true); await click(copy.refresh); expect(calls).toHaveLength(3);
    await currentBody.finish(inbox([claimed])); expectCounts(0, 1); noMutationControls(); noPosts();
  });

  it.each(["accountId", "accountCreatedAt", "memberGeneration", "wallet"] as const)("does not carry old four-tuple data across a fresh %s boundary", async key => {
    await ready(); await click(copy.refresh); const oldBody = await holdBody(1);
    await invalidate("keryx:auth"); expect(calls[1].signal.aborted).toBe(true); cleared();
    const current = { ...recipient, [key]: key === "wallet" ? otherWallet : replacement[key] };
    if (key === "wallet") { auth.session = { address: otherWallet, role: "asker" }; await render(); }
    else await click(copy.refresh);
    const currentRow = { ...claimed, runId: "synthetic-current-body" };
    await reply(2, inbox([currentRow], current)); expectCounts(0, 1);
    expect(new Headers(calls[2].init.headers).get("x-keryx-expected-wallet")).toBe(current.wallet);
    await oldBody.finish(inbox([{ ...assigned, runId: "synthetic-stale-body" }]));
    expect(container.textContent).toContain(currentRow.runId); expect(container.textContent).not.toContain("synthetic-stale-body");
    expectCounts(0, 1); noMutationControls(); noPosts();
    // A fresh same-wallet GET may describe a recreated account/generation.
    // Only the separately checked native reply establishes that authority.
  });

  it("retires a same-wallet old role and its held body before reading the new role", async () => {
    await render(); const oldBody = await holdBody(0);
    auth.session = { address: wallet, role: "owner" }; await render();
    expect(calls[0].signal.aborted).toBe(true); expect(calls).toHaveLength(2); cleared();
    await reply(1, inbox([claimed])); await oldBody.finish(inbox([{ ...assigned, runId: "synthetic-stale-body" }]));
    expectCounts(0, 1); expect(container.textContent).not.toContain("synthetic-stale-body"); noMutationControls(); noPosts();
  });

  it("retires logout/unmount listeners and refuses held bodies and retained refresh handlers", async () => {
    await ready(); const oldRefresh = retainHandler(button(copy.refresh), "onClick");
    await click(copy.refresh); const oldBody = await holdBody(1);
    auth.session = null; await render(); expect(calls[1].signal.aborted).toBe(true);
    expect(AuthChannel.instances.every(channel => channel.closed)).toBe(true);
    await act(async () => oldRefresh(new Event("click"))); expect(calls).toHaveLength(2);
    await oldBody.finish(inbox()); expect(container.querySelector('a[href="/connect"]')).not.toBeNull();
    auth.session = { address: wallet, role: "asker" }; await render(); const currentBody = await holdBody(2);
    await unmount(); expect(calls[2].signal.aborted).toBe(true);
    await invalidate("keryx:auth"); await invalidate("focus"); await invalidate("BroadcastChannel");
    await currentBody.finish(inbox()); expect(container.textContent).toBe(""); expect(calls).toHaveLength(3); noPosts();
  });
});

describe("owner269 mode retirement and default manage compatibility (SOURCE ONLY / UNRUN)", () => {
  it("retires every old manage DOM handler when switching to read-only and does not restore proposal authority when switching back", async () => {
    await ready("default"); await prepareConsent();
    const form = container.querySelector("form")!, oldSubmit = retainHandler(form, "onSubmit");
    const oldButtons = [copy.confirm, copy.reject, copy.withdraw, copy.refresh].map(text => button(text));
    const oldClicks = oldButtons.map(node => retainHandler(node, "onClick"));
    await render(true); expect(calls).toHaveLength(2); cleared(); noMutationControls();
    const invokeOld = async () => act(async () => {
      for (const node of oldButtons) node.click(); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      for (const handler of oldClicks) handler(new Event("click")); oldSubmit(new Event("submit", { cancelable: true }));
    });
    await invokeOld(); expect(calls).toHaveLength(2);
    await reply(1, inbox()); await invokeOld(); expectCounts(1, 1); noMutationControls(); noPosts(); expect(calls).toHaveLength(2);
    await render(false); await reply(2, inbox());
    expect(container.querySelector<HTMLTextAreaElement>("form textarea")!.value).toBe("");
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(node => node.checked)).toEqual([false, false]);
    expect(button(copy.consent).disabled).toBe(true); await invokeOld(); noPosts(); expect(calls).toHaveLength(3);
    await click(copy.confirm); expect(calls[3].init.method).toBe("POST"); // Only the fresh manage handler has authority.
  });

  it.each(["held", "unknown"] as const)("destroys %s manage recovery across a read-only transition and never replays it", async outcome => {
    await ready(false); await click(copy.confirm);
    const body = JSON.parse(String(calls[1].init.body)), original = calls[1].init.body;
    const oldBody = outcome === "held" ? await holdBody(1) : undefined;
    if (outcome === "unknown") await reject(1);
    expect(container.querySelector<HTMLTextAreaElement>("textarea[readonly]")?.value).toBe(original);
    const oldResolve = retainHandler(button(copy.resolve), "onClick");
    await render(true); expect(calls).toHaveLength(3);
    if (outcome === "held") expect(calls[1].signal.aborted).toBe(true);
    noMutationControls();
    await act(async () => oldResolve(new Event("click"))); expect(calls).toHaveLength(3);
    await reply(2, inbox([claimed]));
    await oldBody?.finish({ ...inbox([{ ...assigned, runId: "synthetic-stale-body" }]), receipt: receipt("confirm", body.input.requestId) });
    await act(async () => oldResolve(new Event("click"))); expect(calls).toHaveLength(3); expectCounts(0, 1);
    expect(container.textContent).not.toContain("synthetic-stale-body"); noMutationControls(); noPosts(2);
    await render(false); await reply(3, inbox());
    expect(container.querySelector("textarea[readonly]")).toBeNull(); expect(button(copy.confirm).disabled).toBe(false);
    await act(async () => oldResolve(new Event("click"))); expect(calls).toHaveLength(4); noPosts(2);
  });

  it("retires same-wallet old manage handlers on role change", async () => {
    await ready("default"); const oldConfirm = retainHandler(button(copy.confirm), "onClick");
    const oldRefresh = retainHandler(button(copy.refresh), "onClick");
    auth.session = { address: wallet, role: "owner" }; await render("default"); await reply(1, inbox());
    await act(async () => { oldRefresh(new Event("click")); oldConfirm(new Event("click")); });
    expect(calls).toHaveLength(2); noPosts();
    await click(copy.confirm); expect(calls[2].init.method).toBe("POST");
  });

  it.each(["confirm", "reject", "withdraw"] as const)("preserves the default manage %s body and controls", async action => {
    await ready("default");
    expect(container.querySelector("form")).not.toBeNull();
    expect(button(copy.consent).disabled).toBe(true); expect(button(copy.confirm).disabled).toBe(false);
    expect(button(copy.reject).disabled).toBe(false); expect(button(copy.withdraw).disabled).toBe(false);
    const row = action === "withdraw" ? claimed : assigned;
    await click(action === "confirm" ? copy.confirm : action === "reject" ? copy.reject : copy.withdraw);
    const body = JSON.parse(String(calls[1].init.body)); expect(body.input.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(body).toEqual({ expected: recipient, input: { action, requestId: body.input.requestId,
      expected: { assignmentId: row.assignmentId, revision: row.revision } } });
    expect(new Headers(calls[1].init.headers).get("content-type")).toBe("application/json");
    expect(new Headers(calls[1].init.headers).get("x-keryx-expected-wallet")).toBe(wallet);
    await reply(1, { ...inbox([]), receipt: receipt(action, body.input.requestId) });
    expect(container.querySelector("textarea[readonly]")).toBeNull(); expect(container.textContent).toContain(copy.historical);
    expect(calls).toHaveLength(2);
  });

  it("preserves explicit manifest consent, both required acknowledgements and exact unknown-outcome replay in default manage mode", async () => {
    await ready("default"); expect(button(copy.consent).disabled).toBe(true); await click(copy.consent); expect(calls).toHaveLength(1);
    await prepareConsent();
    const checks = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks).toHaveLength(2); expect(checks.every(node => node.required)).toBe(true);
    for (const check of checks) {
      await act(async () => check.click()); await click(copy.consent); expect(calls).toHaveLength(1);
      await act(async () => check.click());
    }
    await click(copy.consent);
    const original = calls[1].init.body, body = JSON.parse(String(original));
    expect(body).toEqual({ expected: recipient, input: { action: "consent", requestId: body.input.requestId,
      manifest, acknowledgeAssignedLabel: true, noFinancialAuthority: true } });
    await reject(1); expect(status()).toBe(copy.unknown);
    expect(container.querySelector<HTMLTextAreaElement>("textarea[readonly]")?.value).toBe(original);
    await click(copy.resolve); expect(calls[2].init.method).toBe("POST"); expect(calls[2].init.body).toBe(original);
    await reply(2, { ...inbox([]), receipt: receipt("consent", body.input.requestId) });
    expect(status()).toBe(copy.pendingConsent); expect(container.querySelector("textarea[readonly]")).toBeNull(); expect(calls).toHaveLength(3);
  });
});
