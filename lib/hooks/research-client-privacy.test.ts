// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AskForm } from "@/components/keryx/ask-form";
import { ResearchChat } from "@/components/keryx/research-chat";
import { useResearchVisibility } from "./use-research-visibility";

// Real visibility, composer, chat and stream hooks. Only HTTP and unrelated panels are synthetic.
vi.mock("@/lib/hooks/use-research-availability", () => ({ useResearchAvailability: () => ({
  availability: { state: "not-paused" }, checking: false, refresh: async () => ({ state: "not-paused" }),
}) }));
vi.mock("@/components/keryx/session-grant-panel", () => ({ SessionGrantPanel: () => null }));
vi.mock("@/components/keryx/onboarding-tour", () => ({ OnboardingTour: () => null }));
vi.mock("@/components/keryx/globe-watermark", () => ({ GlobeWatermark: () => null }));
vi.mock("@/components/keryx/sponsored-trial-notice", () => ({ SponsoredTrialNotice: () => null }));
vi.mock("@/components/keryx/product-hunt-badge", () => ({ ProductHuntBadge: () => null }));
vi.mock("@/components/keryx/research-turn", () => ({ ResearchTurn: ({ turn }: { turn: { question: string; state: { run?: { answer: string } | null } } }) =>
  createElement("article", { "data-testid": "synthetic-turn" }, turn.question, turn.state.run?.answer) }));

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
type Context = { wallet: string | null; defaultVisibility: "public" | "unlisted" | "private"; privacyActive: boolean };
const context = (wallet: string | null = alice, defaultVisibility: Context["defaultVisibility"] = "private"): Context => ({ wallet, defaultVisibility, privacyActive: true });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
type Ask = { init: RequestInit; question: string; controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean };
let root: Root | undefined, container: HTMLDivElement, asks: Ask[];
let respond: () => Response | Promise<Response>, contexts: RequestInit[];
let preference: ReturnType<typeof useResearchVisibility>;
class Channel {
  static instances: Channel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor() { Channel.instances.push(this); }
  close() { this.closed = true; }
  postMessage() { /* No peer or real browser transport. */ }
}
function Probe({ parent }: { parent?: "public" | "unlisted" | "private" }) {
  preference = useResearchVisibility(parent);
  return createElement("output", null, preference.status);
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render(node: Parameters<Root["render"]>[0]) {
  await act(async () => { root ??= createRoot(container); root.render(node); }); await flush();
}
async function type(question: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, question);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(value: string) {
  await act(async () => { const select = container.querySelector("[data-testid=research-visibility] select")! as HTMLSelectElement;
    select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function submit() { await act(async () => { (container.querySelector("[data-tour=dispatch-btn]") as HTMLButtonElement).click(); }); }
async function auth(detail?: unknown) { await act(async () => { window.dispatchEvent(new CustomEvent("keryx:auth", { detail })); }); }
async function focus() { await act(async () => { window.dispatchEvent(new Event("focus")); }); }
async function frame(ask: Ask, event: string, data: unknown) {
  await act(async () => { ask.controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); });
}
async function finish(ask: Ask, answer: string) {
  await frame(ask, "done", { id: `synthetic-run-${asks.indexOf(ask)}`, answer });
  await act(async () => { ask.closed = true; ask.controller.close(); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", Channel); Channel.instances = [];
  if (!Element.prototype.scrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, configurable: true });
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
  container = document.createElement("div"); document.body.append(container);
  window.history.replaceState(null, "", "/"); asks = []; contexts = [];
  respond = () => json(context());
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === "/api/ask/visibility") { contexts.push(init); return respond(); }
    if (url === "/api/models") return json({ models: [] });
    if (url === "/api/sources") return json({ sources: [] });
    if (url === "/api/ask") {
      const request = JSON.parse(String(init.body));
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
      asks.push({ init, question: request.question, controller, closed: false });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`Unexpected synthetic HTTP boundary: ${url}`);
  }));
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); root = undefined; });
  for (const ask of asks) if (!ask.closed) { ask.closed = true; ask.controller.close(); }
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("uses saved private default, explicit per-question choices, and anonymous Unlisted without a private fallback", async () => {
  await render(createElement(Probe));
  expect(preference.getSelection()).toEqual({ visibility: "private", expectedWallet: alice });
  await act(async () => preference.choose("unlisted"));
  expect(preference.getSelection()).toEqual({ visibility: "unlisted", expectedWallet: alice });
  respond = () => json(context(null, "public")); await auth();
  await act(async () => preference.choose("unlisted"));
  expect(preference.getSelection()).toEqual({ visibility: "unlisted", expectedWallet: null });
  await act(async () => preference.choose("private"));
  expect(preference.getSelection()?.visibility).toBe("unlisted");
});

it("refuses initial, failed, oversized and invalid visibility context", async () => {
  const held = deferred<Response>(); respond = () => held.promise;
  await render(createElement(Probe)); expect(preference.getSelection()).toBeNull();
  await act(async () => held.resolve(json({}, 503)));
  expect(preference.status).toBe("error"); expect(preference.getSelection()).toBeNull();
  for (const bad of [context(null, "private"), { ...context(), wallet: "not-a-wallet" }, { ...context(), padding: "x".repeat(4096) }]) {
    respond = () => json(bad); await act(async () => preference.retry());
    expect(preference.status).toBe("error"); expect(preference.getSelection()).toBeNull();
  }
});

it("ignores a delayed prior-account reply and aborts its context request", async () => {
  await render(createElement(Probe));
  const old = deferred<Response>(); respond = () => old.promise; await auth();
  const prior = contexts.at(-1)!; expect(preference.getSelection()).toBeNull();
  respond = () => json(context(bob, "public")); await auth();
  expect(prior.signal?.aborted).toBe(true);
  await act(async () => old.resolve(json(context(alice, "private"))));
  expect(preference.getSelection()).toEqual({ visibility: "public", expectedWallet: bob });
});

it("preserves a same-owner explicit choice across overlapping focus checks", async () => {
  await render(createElement(Probe)); await act(async () => preference.choose("unlisted"));
  const first = deferred<Response>(); respond = () => first.promise; await focus();
  const second = deferred<Response>(); respond = () => second.promise; await focus();
  await act(async () => second.resolve(json(context(alice, "public"))));
  await act(async () => first.resolve(json(context(bob, "public"))));
  expect(preference.getSelection()).toEqual({ visibility: "unlisted", expectedWallet: alice });
  expect(preference.identityRevision).toBe(0);
});

it("hides a private draft while focused context is pending and preserves same-owner work and choice", async () => {
  const onAsk = vi.fn(); await render(createElement(AskForm, { onAsk }));
  await type("Synthetic private draft");
  const held = deferred<Response>(); respond = () => held.promise; await focus();
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  expect((container.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true);
  expect(container.querySelector("[data-testid=paper-metadata-handoff]")?.getAttribute("href")).not.toContain("Synthetic");
  await act(async () => held.resolve(json(context(alice, "public"))));
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Synthetic private draft");
  await submit();
  expect(onAsk).toHaveBeenCalledOnce(); expect(onAsk.mock.calls[0].at(-1)).toEqual({ visibility: "private", expectedWallet: alice });
});

it("clears an old draft on pending logout and cannot submit it under the next account", async () => {
  const onAsk = vi.fn(); await render(createElement(AskForm, { onAsk })); await choose("unlisted"); await type("Alice hidden draft");
  const count = contexts.length;
  await auth({ type: "logout", pending: true, confirmed: false }); await submit();
  expect(contexts).toHaveLength(count); expect(onAsk).not.toHaveBeenCalled();
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  respond = () => json(context(bob, "public")); await auth({ type: "logout", pending: false, confirmed: true });
  await submit(); expect(onAsk).not.toHaveBeenCalled();
  await type("Bob public draft"); await submit();
  expect(onAsk.mock.calls[0][0]).toBe("Bob public draft"); expect(onAsk.mock.calls[0].at(-1)).toEqual({ visibility: "public", expectedWallet: bob });
});

it("prefills a shared question and dispatches its opt-in once only after verified context", async () => {
  window.history.replaceState(null, "", "/?q=Synthetic%20shared%20question&run=1&budget=0");
  const held = deferred<Response>(); respond = () => held.promise;
  const onAsk = vi.fn(); await render(createElement(AskForm, { onAsk }));
  expect(onAsk).not.toHaveBeenCalled();
  await act(async () => held.resolve(json(context()))); await flush();
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Synthetic shared question");
  expect(onAsk).toHaveBeenCalledOnce(); expect(onAsk.mock.calls[0][0]).toBe("Synthetic shared question");
  expect(onAsk.mock.calls[0].at(-1)).toEqual({ visibility: "private", expectedWallet: alice });
});

it("inherits hidden parents and refuses an anonymous private parent", async () => {
  const onAsk = vi.fn(); await render(createElement(AskForm, { onAsk, parentVisibility: "private" }));
  await choose("public"); await type("Hidden follow-up"); await submit();
  expect(onAsk.mock.calls[0].at(-1)).toEqual({ visibility: "private", expectedWallet: alice });
  respond = () => json(context(null, "public")); await auth();
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  expect((container.querySelector("[data-tour=dispatch-btn]") as HTMLButtonElement).disabled).toBe(true);
});

it.each(["pending logout", "verified account change"])("clears private chat/history, aborts and fences late stream data after %s", async boundary => {
  await render(createElement(ResearchChat));
  expect(contexts).toHaveLength(1); // Composer shares the chat authority, with no second lookup.
  await type("Alice first private question"); await submit();
  expect(new Headers(asks[0].init.headers).get("X-Keryx-Expected-Wallet")).toBe(alice);
  expect(JSON.parse(String(asks[0].init.body)).visibility).toBe("private");
  await frame(asks[0], "meta", { engine: "synthetic", mode: "offline", visibility: "private", visibilityOwner: alice });
  await finish(asks[0], "Alice first private answer");
  await type("Alice second private question"); await submit();
  await frame(asks[1], "meta", { engine: "synthetic", mode: "offline", visibility: "private", visibilityOwner: alice });
  expect(container.textContent).toContain("Alice first private answer");
  const old = asks[1];
  if (boundary === "pending logout") await auth({ type: "logout", pending: true, confirmed: false });
  respond = () => json(context(bob, "public"));
  await auth(boundary === "pending logout" ? { type: "logout", pending: false, confirmed: true } : undefined);
  expect(old.init.signal?.aborted).toBe(true); expect(container.textContent).not.toContain("Alice first"); expect(container.textContent).not.toContain("Alice second");
  await type("Bob public question"); await submit();
  await frame(asks[2], "meta", { engine: "synthetic", mode: "offline", visibility: "public" });
  await finish(old, "Late Alice private answer");
  expect(container.textContent).not.toContain("Alice");
  await finish(asks[2], "Bob public answer"); expect(container.textContent).toContain("Bob public answer");
});

it("hides an in-flight private turn on focus and restores it for the same owner without aborting", async () => {
  await render(createElement(ResearchChat)); await type("Private work survives focus"); await submit();
  const stream = asks[0]; await frame(stream, "meta", { engine: "synthetic", mode: "offline", visibility: "private", visibilityOwner: alice });
  const held = deferred<Response>(); respond = () => held.promise; await focus();
  expect(container.textContent).not.toContain("Private work survives focus"); expect(stream.init.signal?.aborted).toBe(false);
  await act(async () => held.resolve(json(context(alice, "public"))));
  expect(container.textContent).toContain("Private work survives focus"); expect(stream.init.signal?.aborted).toBe(false);
  await finish(stream, "Same-owner safe answer"); expect(container.textContent).toContain("Same-owner safe answer");
});

it("preserves normal public history across an account change", async () => {
  respond = () => json(context(alice, "public")); await render(createElement(ResearchChat)); await type("Public question"); await submit();
  await frame(asks[0], "meta", { engine: "synthetic", mode: "offline", visibility: "public" }); await finish(asks[0], "Public answer");
  respond = () => json(context(bob, "public")); await auth(); expect(container.textContent).toContain("Public answer");
});

it("transmits explicit anonymous Unlisted choice and refuses a mismatched private SSE owner", async () => {
  respond = () => json(context(null, "public")); await render(createElement(ResearchChat));
  await choose("unlisted"); await type("Anonymous link-readable question"); await submit();
  expect(JSON.parse(String(asks[0].init.body)).visibility).toBe("unlisted");
  expect(new Headers(asks[0].init.headers).get("X-Keryx-Expected-Wallet")).toBe("anonymous");
  await frame(asks[0], "meta", { engine: "synthetic", mode: "offline", visibility: "private", visibilityOwner: bob });
  expect(asks[0].init.signal?.aborted).toBe(true);
  expect(container.textContent).not.toContain("Anonymous link-readable question");
});

it("aborts owned streams and context requests on unmount; delayed replies cannot restore a view", async () => {
  await render(createElement(ResearchChat)); await type("Unmounted private question"); await submit();
  const held = deferred<Response>(); respond = () => held.promise; await focus();
  const pending = contexts.at(-1)!; await act(async () => { root!.unmount(); root = undefined; });
  expect(asks[0].init.signal?.aborted).toBe(true); expect(pending.signal?.aborted).toBe(true);
  expect(Channel.instances.every(channel => channel.closed)).toBe(true);
  await act(async () => held.resolve(json(context()))); await finish(asks[0], "Late unmounted answer");
  expect(container.textContent).toBe("");
});
