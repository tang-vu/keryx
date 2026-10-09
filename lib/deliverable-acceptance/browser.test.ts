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
