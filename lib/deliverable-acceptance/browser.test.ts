import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { DeliverableAcceptance } from "../../components/keryx/deliverable-acceptance";
import { acceptanceFixture } from "./test-fixture";
vi.mock("../hooks/use-siwe-auth", () => ({ useSiweAuth: () => ({ session: { address: `0x${"11".repeat(20)}` } }) }));
vi.mock("next/link", () => ({ default: "a" }));
it("deferred digest cannot enable changed displayed bytes, and acknowledged consent refreshes the public state", async () => {
  const fixture = await acceptanceFixture(), snapshot = fixture.snapshot, answer = "Synthetic delivered answer 😀";
  fixture.db.close();
  const dom = new JSDOM('<div id="root"></div>'), container = dom.window.document.getElementById("root")!;
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const deferred: Array<() => void> = [];
  vi.stubGlobal("crypto", { randomUUID: () => "synthetic-browser-request-0001", subtle: { digest: (_algorithm: string, bytes: Uint8Array) =>
    new Promise<ArrayBuffer>(resolve => { const hash = createHash("sha256").update(bytes).digest(); deferred.push(() => resolve(Uint8Array.from(hash).buffer)); }) } });
  let publicReads = 0, shared = false, posts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith("/api/me/")) {
      if (options?.method === "POST") { posts++; shared = true; return Response.json({ ...snapshot, state: "accepted", revision: 1, publishState: true, submittedAt: "2026-10-09T00:00:00.000Z" }); }
      return Response.json(snapshot);
    }
    publicReads++; return Response.json({ format: "keryx-public-deliverable-state-v1", state: shared ? "accepted" : "not_shared", submittedAt: shared ? "2026-10-09T00:00:00.000Z" : null });
  }));
  const root = createRoot(container), button = () => Array.from(container.querySelectorAll("button")).find(value => value.textContent === "Accept")!;
  try {
    await act(async () => { root.render(createElement(DeliverableAcceptance, { id: snapshot.id, answer })); });
    expect(button().disabled).toBe(true);
    await act(async () => { deferred.splice(0).forEach(finish => finish()); }); expect(button().disabled).toBe(false);
    await act(async () => { root.render(createElement(DeliverableAcceptance, { id: snapshot.id, answer: "Changed displayed answer" })); });
    expect(button().disabled).toBe(true); await act(async () => { button().click(); }); expect(posts).toBe(0);
    await act(async () => { deferred.splice(0).forEach(finish => finish()); }); expect(button().disabled).toBe(true);
    await act(async () => { root.render(createElement(DeliverableAcceptance, { id: snapshot.id, answer })); });
    expect(button().disabled).toBe(true);
    await act(async () => { deferred.splice(0).forEach(finish => finish()); }); expect(button().disabled).toBe(false);
    await act(async () => { button().click(); }); expect(posts).toBe(1); expect(publicReads).toBe(2);
    expect(container.textContent).toContain("Customer acceptance: Accepted");
  } finally { await act(async () => root.unmount()); dom.window.close(); vi.unstubAllGlobals(); }
});

it.each(["old snapshot", "old failure"] as const)("a delayed initial owner read cannot replace an acknowledged choice with an %s", async late => {
  const fixture = await acceptanceFixture();
  const answer = "Synthetic request-ordering answer";
  const snapshot = { ...fixture.snapshot, answerDigest: createHash("sha256").update(answer).digest("hex") };
  fixture.db.close();
  const dom = new JSDOM('<div id="root"></div>'), container = dom.window.document.getElementById("root")!;
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", { randomUUID: () => "synthetic-browser-request-0002", subtle: { digest: async (_algorithm: string, bytes: Uint8Array) =>
    Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer } });
  let finishInitial!: (value: Response) => void, ownerReads = 0;
  const initial = new Promise<Response>(resolve => { finishInitial = resolve; });
  const posts: Array<{ expectedRevision: number; choice: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (!url.startsWith("/api/me/")) return Response.json({ format: "keryx-public-deliverable-state-v1", state: "not_shared", submittedAt: null });
    if (options?.method !== "POST") return ++ownerReads === 1 ? initial : Response.json(snapshot);
    const input = JSON.parse(String(options.body)); posts.push(input);
    return Response.json({ ...snapshot, revision: posts.length, state: input.choice === "accept" ? "accepted" : "revision_requested", submittedAt: "2026-10-09T00:00:00.000Z" });
  }));
  const root = createRoot(container);
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find(value => value.textContent === text)!;
  try {
    await act(async () => { root.render(createElement(DeliverableAcceptance, { id: snapshot.id, answer })); });
    await act(async () => { button("Read current state").click(); });
    expect(button("Accept").disabled).toBe(false);
    await act(async () => { button("Accept").click(); });
    expect(posts).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('[role="status"]')).some(value => value.textContent === "Accepted")).toBe(true);
    await act(async () => { finishInitial(late === "old snapshot" ? Response.json(snapshot) : new Response(null, { status: 503 })); });
    expect(Array.from(container.querySelectorAll('[role="status"]')).some(value => value.textContent === "Accepted")).toBe(true);
    expect(container.querySelector('[role="alert"]') === null).toBe(true);
    await act(async () => { button("Request revision").click(); });
    expect(posts.map(input => input.expectedRevision)).toEqual([0, 1]);
  } finally { await act(async () => root.unmount()); dom.window.close(); vi.unstubAllGlobals(); }
});
