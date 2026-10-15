/** SOURCE PROPOSAL ONLY, UNRUN. Fixed synthetic HTTP envelopes, no native port,
 * owner capability, provider, signature, database or financial operation.
 * Compile the real inbox with the existing esbuild boundary pattern from
 * topic-watch-service.test.ts; use consent-ui.test.ts's mounted DOM controls,
 * peer auth channel and held-body invalidation pattern. No new test framework.
 * Ordinary assertions deliberately retain the separately reported recovery
 * erasure regression; do not skip it or turn it into an expected failure. */
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { MessageChannel as TaskChannel } from "node:worker_threads";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ownerRunAssignmentMessages as copy } from "../../locales/en/owner-run-assignments";
import type { Manifest, Receipt, Recipient } from "./contracts";
import type { AssignmentInbox, InboxItem } from "./projection";

const wallet = `0x${"a".repeat(40)}`, otherWallet = `0x${"b".repeat(40)}`;
const recipient: Recipient = { accountId: `acct_${"c".repeat(64)}`, accountCreatedAt: 1000,
  wallet, memberGeneration: "d".repeat(64) };
const replacement: Recipient = { accountId: `acct_${"e".repeat(64)}`, accountCreatedAt: 2000,
  wallet, memberGeneration: "f".repeat(64) };
const assignmentId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const differentId = "33333333-3333-4333-8333-333333333333";
const manifest: Manifest = { version: 1,
  binding: { network: "eip155:5042002", origin: "https://owner269.invalid", storageDigest: "1".repeat(64) },
  recipient, basis: { code: "documented-recipient-request", reference: "synthetic-ui-only" },
  scope: "association-history-and-confirmation", admissionExpiresAt: 1_900_000_000_000,
  members: [{ assignmentId, runId: "synthetic-owner269-run", originalSha256: "2".repeat(64),
    completedAt: "2026-10-01T00:00:00.000Z" }] };
const assigned: InboxItem = { assignmentId, revision: 1, status: "assigned-by-owner",
  assignedAt: 1_790_812_800_000, confirmedAt: null, admissionExpiresAt: manifest.admissionExpiresAt,
  effective: true, runId: manifest.members[0].runId, network: manifest.binding.network, attribution: "assigned-by-owner" };
function inbox(history: InboxItem[] = [assigned], current = recipient): AssignmentInbox {
  return { version: 1, kind: "owner-assignment-inbox", recipient: current, history,
    profile: { assignedByOwner: history.filter(row => row.effective && row.attribution === "assigned-by-owner").length,
      claimedFromOwnerAssignment: history.filter(row => row.effective && row.attribution === "claimed-from-owner-assignment").length } };
}
function receipt(action: Receipt["action"] = "consent", id = requestId): Receipt {
  return { version: 1, requestId: id, inputDigest: "3".repeat(64), action, committedAt: 1_790_812_801_000,
    results: [], meaning: "historical-committed-result-not-current-authority" };
}
function consentBody(current = recipient, proposal = manifest) {
  return { expected: current, input: { action: "consent", requestId, manifest: proposal,
    acknowledgeAssignedLabel: true, noFinancialAuthority: true } };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Session = { address: string; role: string } | null | undefined;
type Ui = { act(work: () => void | Promise<void>): Promise<void>; render(): void; unmount(): void };
type FixtureWindow = Window & typeof globalThis & { fixtureSession: Session; fixtureUi: Ui; IS_REACT_ACT_ENVIRONMENT: boolean };
type Boundary = "keryx:auth" | "focus" | "BroadcastChannel";
let bundle: string;

beforeAll(async () => {
  const output = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), sourcefile: "owner269-inbox-dom-fixture.tsx", contents: `
    import React,{act}from'react';import{createRoot}from'react-dom/client';
    import{OwnerRunAssignmentInbox}from'./components/keryx/owner-run-assignment-inbox';
    const root=createRoot(document.getElementById('root'));
    window.fixtureUi={act,render:()=>root.render(<OwnerRunAssignmentInbox/>),unmount:()=>root.unmount()};
  ` }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    // React's own act is exported from this same compiled React instance.
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "owner269-session-link-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/link"
        ? "import React from 'react';export default function Link(props){return <a {...props}/>}"
        : "export function useSiweAuth(){return{session:window.fixtureSession}}" }));
    } }] });
  // Only session and framework navigation are synthetic. Contracts, projection,
  // formatter, English copy, effects, form and request/recovery logic are real.
  const inputs = Object.keys(output.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  for (const path of ["components/keryx/owner-run-assignment-inbox.tsx", "lib/owner-run-assignments/contracts.ts",
    "lib/owner-run-assignments/projection.ts", "lib/i18n/format.ts", "locales/en/owner-run-assignments.ts"])
    expect(inputs).toContain(path);
  bundle = output.outputFiles[0].text;
});

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { while (disposals.length) await disposals.pop()!(); });

function fixture(session: Session = { address: wallet, role: "asker" }) {
  // Existing JSDOM dependency only; no browser launch, listener, build output or
  // script resources. This realm evaluates only the in-memory compiled fixture.
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://owner269.invalid/me/run-assignments", runScripts: "outside-only" });
  const window = dom.window as unknown as FixtureWindow, container = window.document.getElementById("root")!;
  window.fixtureSession = session; window.IS_REACT_ACT_ENVIRONMENT = true;
  Reflect.set(window, "TextEncoder", TextEncoder);
  // JSDOM has no MessageChannel. Give bundled React's act/scheduler the real
  // standard-library task primitive and close every created port at disposal.
  const taskChannels: TaskChannel[] = [];
  Reflect.set(window, "MessageChannel", class extends TaskChannel {
    constructor() { super(); taskChannels.push(this); }
  });
  const uuid = vi.fn(() => requestId);
  Object.defineProperty(window.crypto, "randomUUID", { configurable: true, value: uuid });
  class AuthChannel {
    static instances: AuthChannel[] = [];
    closed = false;
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(readonly name: string) { AuthChannel.instances.push(this); }
    postMessage(data: unknown) {
      for (const peer of AuthChannel.instances) if (peer !== this && !peer.closed && peer.name === this.name)
        peer.onmessage?.(new window.MessageEvent("message", { data }));
    }
    close() { this.closed = true; }
  }
  Reflect.set(window, "BroadcastChannel", AuthChannel);
  const calls: Array<{ path: string; init: RequestInit; signal: AbortSignal; reply: ReturnType<typeof deferred<Response>> }> = [];
  const fetcher = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    expect(path).toBe("/api/me/run-assignments");
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    expect(init.signal).toBeDefined();
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
    const reply = deferred<Response>(); calls.push({ path, init, signal: init.signal as AbortSignal, reply }); return reply.promise;
  });
  Reflect.set(window, "fetch", fetcher);
  window.eval(bundle);
  const ui = window.fixtureUi, bodies: Array<() => void> = [];
  let mounted = true;
  const f = {
    dom, window, container, calls, fetcher, uuid, channels: AuthChannel.instances,
    act: (work: () => void | Promise<void>) => ui.act(work),
    async render(next: Session = window.fixtureSession) { await ui.act(() => { window.fixtureSession = next; ui.render(); }); },
    status() { return container.querySelector('[role="status"]')?.textContent ?? ""; },
    button(text: string) {
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text);
      if (!button) throw new Error(`Missing actual inbox button: ${text}`);
      return button;
    },
    control<T extends HTMLInputElement | HTMLTextAreaElement>(text: string): T {
      const label = [...container.querySelectorAll("label")].find(value => value.textContent?.trim().startsWith(text));
      const input = label?.querySelector<T>("input, textarea");
      if (!input) throw new Error(`Missing actual inbox control: ${text}`);
      return input;
    },
    async click(text: string) { await ui.act(() => { f.button(text).click(); }); },
    async check(text: string) { await ui.act(() => { f.control<HTMLInputElement>(text).click(); }); },
    async paste(text: string) {
      const field = f.control<HTMLTextAreaElement>(copy.consentManifest);
      await ui.act(() => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
        field.dispatchEvent(new window.Event("input", { bubbles: true })); });
    },
    async respond(index: number, value: unknown, status = 200) {
      await ui.act(async () => { calls[index].reply.resolve(Response.json(value, { status })); });
    },
    async reject(index: number) { await ui.act(async () => { calls[index].reply.reject(new Error("Synthetic response lost; commit outcome unknown")); }); },
    async holdBody(index: number) {
      let controller!: ReadableStreamDefaultController<Uint8Array>, finished = false;
      const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }),
        { headers: { "Content-Type": "application/json" } });
      const json = vi.spyOn(response, "json"); // Real streamed body parsing, deliberately independent of fetch abort.
      const finish = (value: unknown) => { if (!finished) { finished = true;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); } };
      bodies.push(() => finish({}));
      await ui.act(async () => { calls[index].reply.resolve(response); });
      expect(json).toHaveBeenCalledOnce();
      return { async finish(value: unknown) { await ui.act(async () => { finish(value); }); } };
    },
    async invalidate(boundary: Boundary) {
      // Keep the synthetic session prop unchanged to test the component's own
      // immediate erasure while a real auth recheck could still be pending.
      await ui.act(() => {
        if (boundary === "BroadcastChannel") { const peer = new AuthChannel("keryx-auth-v1"); peer.postMessage("changed"); peer.close(); }
        else if (boundary === "focus") window.dispatchEvent(new window.Event("focus"));
        else window.dispatchEvent(new window.CustomEvent("keryx:auth", { detail: "changed" }));
      });
    },
    async unmount() { if (mounted) { await ui.act(() => { ui.unmount(); }); mounted = false; } },
    async dispose() {
      try {
        await f.unmount();
        // Drain only synthetic promises/streams, even after a failed assertion.
        await ui.act(async () => { for (const call of calls) call.reply.resolve(Response.json({}, { status: 503 }));
          for (const finish of bodies) finish(); });
      } finally { for (const channel of taskChannels) { channel.port1.close(); channel.port2.close(); } dom.window.close(); }
    },
  };
  disposals.push(() => f.dispose()); return f;
}
type Fixture = ReturnType<typeof fixture>;
async function ready(f: Fixture, value = inbox()) { await f.render(); await f.respond(0, value); }
async function consentReady(f: Fixture, proposal = manifest) {
  await f.paste(JSON.stringify(proposal)); await f.check(copy.acknowledgement); await f.check(copy.financialAcknowledgement);
  expect(f.container.querySelector("form")!.checkValidity()).toBe(true);
}
function cleared(f: Fixture) {
  expect(f.container.querySelector("form")).toBeNull();
  expect(f.container.querySelector(`[aria-label="${copy.profile}"]`)).toBeNull();
  expect(f.container.querySelector("textarea")).toBeNull();
  for (const value of [recipient.accountId, recipient.wallet, recipient.memberGeneration, replacement.accountId,
    assignmentId, manifest.members[0].runId, "synthetic-late-body"])
    expect(f.container.textContent).not.toContain(value);
}
function recoveryJson(f: Fixture) {
  const field = f.control<HTMLTextAreaElement>(copy.recovery); expect(field.readOnly).toBe(true); return field.value;
}

describe("compiled owner269 recipient inbox DOM controls (SOURCE UNRUN)", () => {
  it.each(["checking", "anonymous"] as const)("makes no private IO while %s", async state => {
    const f = fixture();
    f.window.fixtureSession = state === "checking" ? undefined : null;
    await f.render();
    if (state === "checking") expect(f.status()).toBe(copy.checking);
    else expect(f.container.querySelector('a[href="/connect"]')?.textContent).toBe(copy.signIn);
    await f.invalidate("focus"); await f.invalidate("keryx:auth"); await f.invalidate("BroadcastChannel");
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.uuid).not.toHaveBeenCalled();
    expect(f.container.querySelector("form")).toBeNull();
  });

  it("normalizes the session wallet, checks the GET envelope and displays separate qualified attribution", async () => {
    const f = fixture({ address: wallet.toUpperCase(), role: "asker" }); await ready(f);
    expect(f.calls).toHaveLength(1); expect(f.calls[0].init).toMatchObject({ method: "GET", headers: { "x-keryx-expected-wallet": wallet } });
    expect(f.calls[0].init.body).toBeUndefined(); expect(f.calls[0].signal.aborted).toBe(false);
    expect(f.container.textContent).toContain(copy.assigned); expect(f.container.textContent).toContain(assigned.runId);
    expect(f.container.textContent).toContain(manifest.binding.network);
    expect(f.container.querySelector(`[aria-label="${copy.profile}"]`)?.textContent).toContain(`${copy.assignedCount}: 1`);
    expect(f.container.querySelector(`[aria-label="${copy.profile}"]`)?.textContent).toContain(`${copy.claimedCount}: 0`);
    expect(f.container.textContent).toContain(copy.scope); expect(f.container.textContent).toContain(copy.financialAcknowledgement);
    expect(f.control<HTMLInputElement>(copy.acknowledgement).checked).toBe(false);
    expect(f.control<HTMLInputElement>(copy.financialAcknowledgement).checked).toBe(false);
    expect(f.uuid).not.toHaveBeenCalled();
  });

  it("requires an explicit valid manifest and both real required acknowledgements before the exact consent POST", async () => {
    const f = fixture(); await ready(f);
    expect(f.button(copy.consent).disabled).toBe(true); await f.click(copy.consent); expect(f.calls).toHaveLength(1);
    await f.paste("{invalid-json"); expect(f.button(copy.consent).disabled).toBe(true);
    await f.paste(JSON.stringify({ ...manifest, extra: "unaccepted" })); expect(f.button(copy.consent).disabled).toBe(true);
    await f.paste(JSON.stringify(manifest)); expect(f.button(copy.consent).disabled).toBe(false);
    expect(f.container.textContent).toContain(copy.proposalSummary);
    expect(f.control<HTMLTextAreaElement>(copy.consentManifest).required).toBe(true);
    expect(f.control<HTMLInputElement>(copy.acknowledgement).required).toBe(true);
    expect(f.control<HTMLInputElement>(copy.financialAcknowledgement).required).toBe(true);
    // Native button activation invokes form constraint validation. Do not call
    // the private handler or dispatch a synthetic submit that bypasses it.
    expect(f.container.querySelector("form")!.checkValidity()).toBe(false);
    await f.click(copy.consent); expect(f.calls).toHaveLength(1);
    await f.check(copy.acknowledgement); await f.click(copy.consent); expect(f.calls).toHaveLength(1);
    await f.check(copy.acknowledgement); await f.check(copy.financialAcknowledgement);
    await f.click(copy.consent); expect(f.calls).toHaveLength(1);
    await f.check(copy.acknowledgement); expect(f.container.querySelector("form")!.checkValidity()).toBe(true);
    await f.click(copy.consent);
    expect(f.calls).toHaveLength(2); expect(f.uuid).toHaveBeenCalledOnce();
    expect(f.calls[1].init).toMatchObject({ method: "POST", headers: { "x-keryx-expected-wallet": wallet, "Content-Type": "application/json" } });
    expect(f.calls[1].init.body).toBe(JSON.stringify(consentBody()));
    expect(f.button(copy.consent).disabled).toBe(true); expect(f.button(copy.confirm).disabled).toBe(true);
    await f.click(copy.consent); expect(f.calls).toHaveLength(2);
    await f.respond(1, { ...inbox([]), receipt: receipt() });
    expect(f.container.textContent).toContain(copy.pendingConsent); expect(f.container.textContent).toContain(copy.historical);
    expect(f.container.textContent).toContain(copy.empty); expect(f.container.querySelector("textarea[readonly]")).toBeNull();
    expect(f.calls).toHaveLength(2); // Consent response never triggers owner apply, funding or an automatic retry.
  });

  it("uses the latest full recipient generation from a new qualified GET as the consent precondition", async () => {
    const f = fixture(); await ready(f); await f.click(copy.refresh);
    await f.respond(1, inbox([], replacement)); const proposal = { ...manifest, recipient: replacement };
    await consentReady(f, proposal); await f.click(copy.consent);
    expect(f.calls[2].init.body).toBe(JSON.stringify(consentBody(replacement, proposal)));
    await f.respond(2, { ...inbox([], replacement), receipt: receipt() });
    expect(f.status()).toBe(copy.pendingConsent); expect(f.calls).toHaveLength(3);
  });

  it.each(["confirm", "reject", "withdraw"] as const)("sends only the displayed assignment revision on explicit %s", async action => {
    const row: InboxItem = action === "withdraw" ? { ...assigned, status: "claimed", attribution: "claimed-from-owner-assignment", confirmedAt: assigned.assignedAt + 1000 }
      : action === "reject" ? { assignmentId, revision: 4, status: "assigned-by-owner", effective: false,
        assignedAt: assigned.assignedAt, confirmedAt: null, admissionExpiresAt: manifest.admissionExpiresAt } : assigned;
    const f = fixture(); await ready(f, inbox([row])); expect(f.calls).toHaveLength(1);
    if (action === "reject") { expect(f.container.textContent).toContain(copy.suppressed); expect(f.button(copy.confirm).disabled).toBe(true); }
    if (action === "withdraw") expect(f.container.textContent).toContain(copy.claimed);
    await f.click(action === "confirm" ? copy.confirm : action === "reject" ? copy.reject : copy.withdraw);
    expect(f.calls[1].init.method).toBe("POST");
    expect(f.calls[1].init.body).toBe(JSON.stringify({ expected: recipient, input: { action, requestId,
      expected: { assignmentId: row.assignmentId, revision: row.revision } } }));
    expect(f.uuid).toHaveBeenCalledOnce();
    await f.respond(1, { ...inbox([]), receipt: receipt(action) }); expect(f.calls).toHaveLength(2);
    expect(f.container.textContent).toContain(copy.historical); expect(f.container.textContent).toContain(copy.empty);
  });

  it("keeps unknown POST bytes and resolves only the same request with an exact replay", async () => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent);
    const original = f.calls[1].init.body; expect(original).toBe(JSON.stringify(consentBody()));
    await f.reject(1); expect(f.status()).toBe(copy.unknown); expect(recoveryJson(f)).toBe(original);
    expect(f.container.querySelector("form")).toBeNull(); expect(f.calls).toHaveLength(2);
    await f.render(); expect(recoveryJson(f)).toBe(original); expect(f.calls).toHaveLength(2);
    await f.click(copy.resolve); expect(f.calls[2].init.body).toBe(original);
    expect(f.button(copy.resolve).disabled).toBe(true); await f.click(copy.resolve); expect(f.calls).toHaveLength(3);
    await f.respond(2, { error: "assignment_outcome_unresolved" }, 503);
    expect(recoveryJson(f)).toBe(original); expect(f.status()).toBe(copy.unknown);
    await f.click(copy.resolve); expect(f.calls[3].init.body).toBe(original); expect(f.uuid).toHaveBeenCalledOnce();
    await f.respond(3, { ...inbox([]), receipt: receipt() });
    expect(f.container.querySelector("textarea[readonly]")).toBeNull(); expect(f.status()).toBe(copy.pendingConsent);
    expect(f.container.textContent).toContain(copy.historical); expect(f.calls).toHaveLength(4);
  });

  it.each([
    ["wrong wallet", { ...inbox(), recipient: { ...recipient, wallet: otherWallet } }],
    ["invalid recipient generation", { ...inbox(), recipient: { ...recipient, memberGeneration: "invalid" } }],
    ["incorrect profile counts", { ...inbox(), profile: { assignedByOwner: 0, claimedFromOwnerAssignment: 0 } }],
    ["partial effective row", { ...inbox(), history: [{ ...assigned, network: undefined }] }],
    ["unknown private field", { ...inbox(), secret: "synthetic-unaccepted-field" }],
    ["wrong envelope kind", { ...inbox(), kind: "owned-history" }],
  ])("refuses %s GET data without rendering or another request", async (_name, body) => {
    const f = fixture(); await f.render(); await f.respond(0, body);
    expect(f.status()).toBe(copy.unavailable); cleared(f);
    expect(f.container.textContent).not.toContain("synthetic-unaccepted-field"); expect(f.calls).toHaveLength(1);
  });

  it("refuses a non-JSON body and HTTP failure even if it contains a valid-looking private envelope", async () => {
    const f = fixture(); await f.render();
    await f.act(async () => { f.calls[0].reply.resolve(new Response("not-json", { headers: { "Content-Type": "application/json" } })); });
    expect(f.status()).toBe(copy.unavailable); cleared(f);
    await f.click(copy.refresh); await f.respond(1, inbox(), 503);
    expect(f.status()).toBe(copy.unavailable); cleared(f); expect(f.calls).toHaveLength(2);
  });

  it.each([
    ["wrong wallet", { ...inbox(), recipient: { ...recipient, wallet: otherWallet }, receipt: receipt() }],
    ["missing receipt", inbox()],
    ["different request receipt", { ...inbox(), receipt: receipt("consent", differentId) }],
    ["invalid body", { ...inbox(), receipt: receipt(), unexpected: true }],
  ])("keeps the exact unresolved request and refuses %s POST data", async (_name, body) => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent); await f.respond(1, body);
    expect(f.status()).toBe(copy.unknown); expect(f.container.querySelector("form")).toBeNull();
    expect(f.container.querySelector(`[aria-label="${copy.profile}"]`)).toBeNull();
    expect(recoveryJson(f)).toBe(JSON.stringify(consentBody())); expect(f.calls).toHaveLength(2);
  });

  it.each<Boundary>(["keryx:auth", "focus", "BroadcastChannel"])("immediately erases settled private controls on %s before explicit revalidation", async boundary => {
    const f = fixture(); await ready(f); await consentReady(f);
    expect(f.channels.map(channel => channel.name)).toEqual(["keryx-auth-v1"]);
    await f.invalidate(boundary); expect(f.status()).toBe(copy.changed); cleared(f); expect(f.calls).toHaveLength(1);
    await f.click(copy.refresh); await f.respond(1, inbox([]));
    expect(f.control<HTMLTextAreaElement>(copy.consentManifest).value).toBe("");
    expect(f.control<HTMLInputElement>(copy.acknowledgement).checked).toBe(false);
    expect(f.control<HTMLInputElement>(copy.financialAcknowledgement).checked).toBe(false);
    expect(f.button(copy.consent).disabled).toBe(true); expect(f.calls).toHaveLength(2);
  });

  it.each<Boundary>(["keryx:auth", "focus", "BroadcastChannel"])("aborts a held GET and refuses its late real JSON body after %s", async boundary => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.refresh);
    const body = await f.holdBody(1); expect(f.calls[1].signal.aborted).toBe(false);
    await f.invalidate(boundary); expect(f.calls[1].signal.aborted).toBe(true); cleared(f);
    await body.finish(inbox([{ ...assigned, runId: "synthetic-late-body" }]));
    cleared(f); expect(f.calls).toHaveLength(2);
  });

  // Known source finding: invalidate() never clears or hides recovery. These
  // required privacy assertions are ordinary tests, UNRUN and predicted to fail
  // on the frozen component. Parent owns any separately allocated runtime fix.
  it.each<Boundary>(["keryx:auth", "focus", "BroadcastChannel"])("erases unknown-outcome recovery data immediately on %s", async boundary => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent); await f.reject(1);
    expect(recoveryJson(f)).toBe(JSON.stringify(consentBody()));
    await f.invalidate(boundary); cleared(f); expect(f.calls).toHaveLength(2);
  });

  it.each<Boundary>(["keryx:auth", "focus", "BroadcastChannel"])("erases recovery, aborts a held POST and refuses its late body after %s", async boundary => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent);
    const body = await f.holdBody(1);
    await f.invalidate(boundary); expect(f.calls[1].signal.aborted).toBe(true);
    // Release in finally so this control also observes late-body refusal when
    // the separately reported immediate-recovery assertion fails.
    try { cleared(f); } finally {
      await body.finish({ ...inbox([{ ...assigned, runId: "synthetic-late-body" }]), receipt: receipt() });
      expect(f.container.querySelector("form")).toBeNull();
      expect(f.container.querySelector(`[aria-label="${copy.profile}"]`)).toBeNull();
      expect(f.container.textContent).not.toContain("synthetic-late-body"); expect(f.calls).toHaveLength(2);
    }
  });

  it("keys wallet replacement, aborts the old request and refuses a held old-wallet body", async () => {
    const f = fixture(); await ready(f); await f.click(copy.refresh); const body = await f.holdBody(1);
    await f.render({ address: otherWallet, role: "asker" });
    expect(f.calls[1].signal.aborted).toBe(true); expect(f.calls).toHaveLength(3); cleared(f);
    expect(new Headers(f.calls[2].init.headers).get("x-keryx-expected-wallet")).toBe(otherWallet);
    await f.respond(2, inbox([], { ...replacement, wallet: otherWallet }));
    await body.finish(inbox([{ ...assigned, runId: "synthetic-late-body" }]));
    expect(f.container.textContent).toContain(copy.empty); expect(f.container.textContent).not.toContain("synthetic-late-body");
    expect(f.control<HTMLInputElement>(copy.acknowledgement).checked).toBe(false);
  });

  it("unmount aborts a held body and removes auth/focus/channel listeners without follow-up IO", async () => {
    const f = fixture(); await f.render(); const body = await f.holdBody(0); await f.unmount();
    expect(f.calls[0].signal.aborted).toBe(true); expect(f.channels.every(channel => channel.closed)).toBe(true);
    await f.invalidate("focus"); await f.invalidate("keryx:auth"); await f.invalidate("BroadcastChannel");
    await body.finish(inbox()); expect(f.container.textContent).toBe(""); expect(f.calls).toHaveLength(1);
  });
});

// Successor controls, also SOURCE ONLY / UNRUN. The original suite above,
// including all six ordinary erasure regressions, is retained verbatim.
function hiddenRecovery(f: Fixture) {
  expect(f.container.querySelector("textarea[readonly]")).toBeNull();
  expect([...f.container.querySelectorAll("button")].some(value => value.textContent === copy.resolve)).toBe(false);
  for (const field of f.container.querySelectorAll<HTMLTextAreaElement>("textarea"))
    expect(field.value).not.toContain(JSON.stringify(consentBody()));
}

describe("owner269 quarantined unknown intent (SOURCE UNRUN)", () => {
  it.each<Boundary>(["keryx:auth", "focus", "BroadcastChannel"])("restores identical recovery only after explicit fresh exact-recipient GET following %s", async boundary => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent);
    const original = f.calls[1].init.body; await f.reject(1);
    expect(recoveryJson(f)).toBe(original);
    await f.invalidate(boundary); cleared(f); hiddenRecovery(f); expect(f.calls).toHaveLength(2);
    await f.render(); hiddenRecovery(f); expect(f.calls).toHaveLength(2);
    await f.click(copy.refresh); expect(f.calls[2].init.method).toBe("GET");
    expect(f.calls[2].init.body).toBeUndefined(); hiddenRecovery(f);
    const validation = await f.holdBody(2); hiddenRecovery(f); expect(f.calls).toHaveLength(3);
    await validation.finish(inbox([]));
    expect(recoveryJson(f)).toBe(original); expect(f.button(copy.resolve).disabled).toBe(false);
    expect(f.button(copy.consent).disabled).toBe(true); expect(f.uuid).toHaveBeenCalledOnce();
    expect(f.calls.map(call => call.init.method)).toEqual(["GET", "POST", "GET"]);
    await f.click(copy.resolve); expect(f.calls[3].init.method).toBe("POST"); expect(f.calls[3].init.body).toBe(original);
    await f.respond(3, { ...inbox([]), receipt: receipt() });
    hiddenRecovery(f); expect(f.status()).toBe(copy.pendingConsent); expect(f.uuid).toHaveBeenCalledOnce();
    expect(f.calls).toHaveLength(4);
  });

  it("fences a pre-render replay click as soon as the auth boundary fires", async () => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent); await f.reject(1);
    const oldResolve = f.button(copy.resolve);
    await f.act(() => {
      f.window.dispatchEvent(new f.window.CustomEvent("keryx:auth", { detail: "changed" }));
      oldResolve.click(); // Same task: the old DOM/handler can precede React's commit.
    });
    cleared(f); hiddenRecovery(f); expect(f.calls).toHaveLength(2); expect(f.uuid).toHaveBeenCalledOnce();
  });

  it("permits fresh validation while an aborted POST body is held, without its old finally unlocking the GET", async () => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent);
    const original = f.calls[1].init.body, oldPost = await f.holdBody(1);
    await f.invalidate("focus"); expect(f.calls[1].signal.aborted).toBe(true); cleared(f);
    await f.click(copy.refresh); expect(f.calls).toHaveLength(3); const validation = await f.holdBody(2);
    await oldPost.finish({ ...inbox([{ ...assigned, runId: "synthetic-late-body" }]), receipt: receipt() });
    cleared(f); hiddenRecovery(f); expect(f.status()).toBe(copy.changed); expect(f.button(copy.refresh).disabled).toBe(true);
    await f.click(copy.refresh); expect(f.calls).toHaveLength(3);
    await validation.finish(inbox([])); expect(recoveryJson(f)).toBe(original);
    expect(f.button(copy.resolve).disabled).toBe(false); expect(f.calls).toHaveLength(3);
    await f.click(copy.resolve); expect(f.calls[3].init.body).toBe(original);
    await f.respond(3, { ...inbox([]), receipt: receipt() }); hiddenRecovery(f);
    expect(f.uuid).toHaveBeenCalledOnce(); expect(f.calls).toHaveLength(4);
  });

  it.each([
    ["different account ID", { ...recipient, accountId: replacement.accountId }],
    ["recreated account", { ...recipient, accountCreatedAt: replacement.accountCreatedAt }],
    ["new member generation", { ...recipient, memberGeneration: replacement.memberGeneration }],
    ["different wallet", { ...recipient, wallet: otherWallet }],
  ] as const)("never revives old recovery for a fresh GET with %s or a late old POST", async (_name, current) => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent);
    const oldPost = await f.holdBody(1); await f.invalidate("BroadcastChannel"); cleared(f);
    await f.click(copy.refresh); await f.respond(2, inbox([], current)); hiddenRecovery(f);
    await oldPost.finish({ ...inbox([{ ...assigned, runId: "synthetic-late-body" }]), receipt: receipt() });
    hiddenRecovery(f); expect(f.container.textContent).not.toContain("synthetic-late-body");
    if (current.wallet === wallet) {
      const proposal = { ...manifest, recipient: current };
      await consentReady(f, proposal); expect(f.button(copy.consent).disabled).toBe(true);
      await f.click(copy.consent); expect(f.calls).toHaveLength(3);
    } else cleared(f);
    await f.invalidate("focus"); cleared(f); await f.click(copy.refresh); await f.respond(3, inbox([], current));
    hiddenRecovery(f); expect(f.calls.map(call => call.init.method)).toEqual(["GET", "POST", "GET", "GET"]);
    expect(f.uuid).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing recipient", { ...inbox([]), recipient: undefined }, 200],
    ["invalid generation", { ...inbox([]), recipient: { ...recipient, memberGeneration: "invalid" } }, 200],
    ["HTTP error with exact-looking data", inbox([]), 503],
    ["absent account", { error: "assignment_unauthenticated" }, 401],
  ] as const)("does not expose or replay quarantine after fresh %s", async (_name, value, status) => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent); await f.reject(1);
    await f.invalidate("keryx:auth"); await f.click(copy.refresh); await f.respond(2, value, status);
    cleared(f); hiddenRecovery(f); expect(f.status()).toBe(copy.unavailable);
    await f.render(); hiddenRecovery(f); expect(f.calls).toHaveLength(3); expect(f.uuid).toHaveBeenCalledOnce();
  });

  it("keeps quarantine private on failed body parsing or lost validation and preserves exact recovery for a later genuine GET", async () => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent);
    const original = f.calls[1].init.body; await f.reject(1); await f.invalidate("focus");
    await f.click(copy.refresh);
    await f.act(async () => { f.calls[2].reply.resolve(new Response("not-json", { headers: { "Content-Type": "application/json" } })); });
    cleared(f); hiddenRecovery(f); await f.click(copy.refresh); await f.reject(3); cleared(f); hiddenRecovery(f);
    expect(f.calls).toHaveLength(4); await f.click(copy.refresh); hiddenRecovery(f); await f.respond(4, inbox([]));
    expect(recoveryJson(f)).toBe(original); expect(f.calls.map(call => call.init.method)).toEqual(["GET", "POST", "GET", "GET", "GET"]);
    expect(f.uuid).toHaveBeenCalledOnce();
  });

  it("refuses a held exact-recipient validation invalidated in its own epoch and requires another explicit GET", async () => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent); await f.reject(1);
    const original = f.calls[1].init.body; await f.invalidate("focus"); await f.click(copy.refresh);
    const validation = await f.holdBody(2); await f.invalidate("BroadcastChannel");
    expect(f.calls[2].signal.aborted).toBe(true); cleared(f); hiddenRecovery(f);
    await validation.finish(inbox([])); cleared(f); hiddenRecovery(f); expect(f.calls).toHaveLength(3);
    await f.click(copy.refresh); await f.respond(3, inbox([])); expect(recoveryJson(f)).toBe(original);
    expect(f.calls.map(call => call.init.method)).toEqual(["GET", "POST", "GET", "GET"]); expect(f.uuid).toHaveBeenCalledOnce();
  });

  it("destroys the unknown-intent holder on actual logout/unmount even when the same wallet signs back in", async () => {
    const f = fixture(); await ready(f); await consentReady(f); await f.click(copy.consent);
    const oldPost = await f.holdBody(1); await f.render(null);
    expect(f.calls[1].signal.aborted).toBe(true); hiddenRecovery(f); expect(f.calls).toHaveLength(2);
    expect(f.container.querySelector('a[href="/connect"]')?.textContent).toBe(copy.signIn);
    await f.render({ address: wallet, role: "asker" }); expect(f.calls).toHaveLength(3);
    await f.respond(2, inbox([])); hiddenRecovery(f);
    await oldPost.finish({ ...inbox([{ ...assigned, runId: "synthetic-late-body" }]), receipt: receipt() });
    hiddenRecovery(f); expect(f.container.textContent).not.toContain("synthetic-late-body");
    await f.click(copy.refresh); await f.respond(3, inbox([])); hiddenRecovery(f);
    await consentReady(f); expect(f.button(copy.consent).disabled).toBe(false);
    expect(f.calls.map(call => call.init.method)).toEqual(["GET", "POST", "GET", "GET"]); expect(f.uuid).toHaveBeenCalledOnce();
  });
});
