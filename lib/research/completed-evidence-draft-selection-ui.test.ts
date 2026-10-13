// @vitest-environment jsdom
// Source-only mounted workspace fixtures; only synthetic session/storage responses.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceDraftWorkspace } from "../../components/keryx/evidence-draft-workspace";
import { completedEvidenceDraftSelectionCopy as copy } from "../../locales/en/completed-evidence-draft-selection";
import { evidenceDraftCopy as editorCopy } from "./evidence-draft-copy";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { createCompletedEvidenceDraftSelectionRoute } from "./completed-evidence-draft-selection";
import { createCompletedEvidenceDraftRoute } from "./completed-evidence-draft-route";
import { downloadBrowserText } from "../browser-text-download";
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import { PAPER_CATALOG } from "../papers/catalog";
import { buildEvidenceDraft } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";

let workspace = evidenceDraftFixture().workspace;
vi.mock("@/lib/papers/literature-browser-store", () => ({ useLiteratureWorkspace: () => ({ ready: true, workspace }) }));
vi.mock("@/lib/browser-text-download", () => ({ downloadBrowserText: vi.fn() }));
const wallet = `0x${"1".repeat(40)}`, id = `prv_${"a".repeat(64)}`, network = "eip155:5042";
function fixture() {
  const claim = "Original research target", baseUrl = window.location.origin;
  const identity = { sourceId: "original-paper", sourceName: "Original", marker: "S1", itemId: "paper-v1", itemUrl: workspace.entries[0].paper.url,
    contentVersion: `sha256:${"b".repeat(64)}`, contentReceipt: { bodyHash: `0x${"c".repeat(64)}`, deliveryKind: "full_text", storageMode: "db_plaintext", plaintextBytes: 200 } };
  const run = { id, asker: wallet, question: "Read exact retained paper", budget: 0.05, researchMode: "deep", origin: "a2a",
    paymentMode: "real", fundingOwner: "treasury", answer: "Saved result [S1].", engine: "synthetic-fixture",
    createdAt: "2026-10-12T01:00:00.000Z", subClaims: [claim],
    citations: [{ ...identity, weight: 1, reward: 0.001, rationale: "Fixture citation" }],
    evidence: [{ ...identity, claimIndex: 0, claim, quote: "The evaluated method improved the measured outcome.", support: 0.8,
      qualifiesForAnswer: true, qualifiesForReward: false }],
    decisions: [{ ...identity, action: "BUY", rationale: "Fixture retained read", targets: [0], price: 0.01 }] };
  const intent = { id, submission: { request: { question: run.question, budget: run.budget, researchMode: run.researchMode },
    payment: { authorization: { from: wallet } } }, requirement: { network } } as unknown as PrivateResearchIntent;
  const db = { getPrivateResearchResult: vi.fn(async () => ({ id, format: "query-run-v1" as const,
    savedAt: "2026-10-12T02:00:00.000Z", serializedRun: JSON.stringify(run) })), getPrivateResearchIntent: vi.fn(async () => intent),
    getPrivateResearchExecution: vi.fn(async () => ({ id, workerId: "12345678-1234-4234-8234-123456789abc", startedAt: "2026-10-12T00:00:00.000Z" })),
    getPrivateResearchInterruption: vi.fn(async () => null) };
  const account = vi.fn(async () => ({ db, wallet }));
  const selection = createCompletedEvidenceDraftSelectionRoute({ baseUrl, network, account });
  const importer = createCompletedEvidenceDraftRoute({ baseUrl, network, account });
  const respond = async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/session") return Response.json({ session: { address: wallet, role: "user" } });
    const headers = new Headers(init?.headers); headers.set("Origin", baseUrl);
    const request = new Request(baseUrl + url, { ...init, headers });
    if (url === "/api/research/evidence-draft/completed-read/selection") return selection(request);
    if (url === "/api/research/evidence-draft/completed-read") return importer(request);
    throw new Error("No query/model/source/payment/history request is admitted");
  };
  return { run, db, account, respond };
}
let root: Root | undefined, container: HTMLDivElement, f: ReturnType<typeof fixture>;
const control = <T extends HTMLElement>(label: string, scope: ParentNode = container): T => {
  const row = [...scope.querySelectorAll("label")].find(row => row.textContent?.trim().startsWith(label));
  if (!row) throw new Error(`Missing control: ${label}`);
  return row.querySelector<T>("input, textarea, select")!;
};
const button = (name: string) => [...container.querySelectorAll("button")].find(row => row.textContent === name)!;
async function click(name: string) {
  expect(button(name)).toBeDefined(); expect(button(name).disabled).toBe(false);
  await act(async () => { button(name).click(); });
}
async function fill(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!;
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
const render = async () => { await act(async () => { root!.render(createElement(EvidenceDraftWorkspace)); }); };
const select = async () => { await fill(control<HTMLInputElement>(copy.jobId), id); await click(copy.read); };
const backup = async () => {
  await click(editorCopy.download.backup);
  return JSON.parse(vi.mocked(downloadBrowserText).mock.calls.at(-1)![0]);
};
beforeEach(async () => {
  workspace = evidenceDraftFixture().workspace; f = fixture();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => f.respond(url, init)));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); }); root = undefined; container.remove();
  vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
describe("completed read mounted in the actual evidence workspace", () => {
  it("reads nothing until explicit metadata action, then permits only the checked job's explicit import", async () => {
    const persisted = vi.spyOn(Storage.prototype, "setItem");
    expect(fetch).not.toHaveBeenCalled(); expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled();
    await fill(control<HTMLInputElement>(copy.jobId), id); expect(fetch).not.toHaveBeenCalled();
    expect(button("Import selected completed result")).toBeUndefined();
    await click(copy.read); expect(container.textContent).toContain(copy.ready);
    expect(vi.mocked(fetch).mock.calls.map(row => row[0])).toEqual(["/api/auth/session", "/api/research/evidence-draft/completed-read/selection"]);
    const init = vi.mocked(fetch).mock.calls[1][1]!;
    expect(init.credentials).toBe("same-origin"); expect(new Headers(init.headers).get("X-Keryx-Expected-Owner")).toBe(wallet);
    expect(JSON.parse(init.body as string)).not.toHaveProperty("owner");
    await click("Import selected completed result");
    const draft = await backup(); expect(draft.reports).toHaveLength(1); expect(draft.reports[0].id).toBe(id);
    expect(buildEvidenceDraft(draft).excerpts).toHaveLength(1);
    expect(persisted).not.toHaveBeenCalled(); persisted.mockRestore();
    expect(vi.mocked(fetch).mock.calls.map(row => row[0])).toEqual(["/api/auth/session", "/api/research/evidence-draft/completed-read/selection", "/api/research/evidence-draft/completed-read"]);
  });
  it("appends against current editors after an async read, preserving passage, notes and blank statement rows", async () => {
    await select(); let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (url, init) => url === "/api/research/evidence-draft/completed-read"
      ? new Promise<Response>(done => { resolve = done; }) : f.respond(String(url), init));
    await click("Import selected completed result");
    await fill(control<HTMLTextAreaElement>(editorCopy.claim.passage), "Pending passage bytes.");
    await fill(control<HTMLTextAreaElement>(editorCopy.theme.notes), "Pending human notes.");
    await click(editorCopy.statement.add);
    await fill(control<HTMLTextAreaElement>(editorCopy.statement.text), " \n\t ");
    const init = vi.mocked(fetch).mock.calls.at(-1)![1]!;
    await act(async () => { resolve(await f.respond("/api/research/evidence-draft/completed-read", init)); });
    expect(control<HTMLTextAreaElement>(editorCopy.statement.text).value).toBe(" \n\t ");
    expect(control<HTMLTextAreaElement>(editorCopy.claim.passage).value).toBe("Pending passage bytes.");
    expect(control<HTMLTextAreaElement>(editorCopy.theme.notes).value).toBe("Pending human notes.");
    const draft = await backup(); expect(draft.reports).toHaveLength(1); expect(draft.passage).toBe("Pending passage bytes.");
    expect(draft.themes[0]).not.toHaveProperty("statements");
  });
  it.each(["metadata", "import"] as const)("discards pending %s on Clear and requires a fresh explicit read/import", async phase => {
    const entry = workspace.entries[0], second = PAPER_CATALOG[1];
    workspace = { ...workspace, entries: [...workspace.entries, { ...entry, paper: second }] };
    const identity = { sourceId: "original-b", itemId: "paper-b", itemUrl: second.url, marker: "S2" };
    f.run.citations.push({ ...f.run.citations[0], ...identity });
    f.run.evidence.push({ ...f.run.evidence[0], ...identity, qualifiesForAnswer: false });
    f.run.decisions.push({ ...f.run.decisions[0], ...identity }); f.run.answer += " [S2]";
    await render();
    const endpoint = phase === "metadata" ? "/api/research/evidence-draft/completed-read/selection" : "/api/research/evidence-draft/completed-read";
    if (phase === "import") await select();
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (url, init) => url === endpoint
      ? new Promise<Response>(done => { resolve = done; }) : f.respond(String(url), init));
    if (phase === "metadata") await select(); else await click("Import selected completed result");
    const call = vi.mocked(fetch).mock.calls.at(-1)!, signal = call[1]!.signal!;
    const response = await f.respond(endpoint, call[1]); expect(response.ok).toBe(true);
    await click(editorCopy.workspace.clear); expect(signal.aborted).toBe(true);
    expect(container.textContent).toContain(editorCopy.workspace.cleared);
    const callsAtClear = vi.mocked(fetch).mock.calls.length;
    expect(control<HTMLInputElement>(copy.jobId).value).toBe(""); expect(button(copy.read).disabled).toBe(true);
    expect(button("Import selected completed result")).toBeUndefined();
    await act(async () => { resolve(response); });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(callsAtClear);
    expect(container.textContent).toContain(editorCopy.workspace.cleared);
    expect(container.textContent).not.toContain(copy.ready); expect(container.textContent).not.toContain(copy.imported);
    expect(button("Import selected completed result")).toBeUndefined();
    const cleared = await backup(), built = buildEvidenceDraft(cleared);
    expect(cleared.reports).toEqual([]); expect(cleared.readingStatuses ?? []).toEqual([]);
    expect(built.excerpts).toEqual([]); expect(built.reading.unavailable).toEqual([]);
    expect(container.textContent).not.toContain(f.run.evidence[0].quote);
    for (const format of ["markdown", "latex", "bibtex", "ris"] as const) {
      await click(editorCopy.download[format]);
      const downloaded = vi.mocked(downloadBrowserText).mock.calls.at(-1)![0];
      expect(downloaded).not.toContain(id); expect(downloaded).not.toContain(f.run.evidence[0].quote);
    }
    vi.mocked(fetch).mockImplementation(async (url, init) => f.respond(String(url), init));
    await select(); expect(container.textContent).toContain(copy.ready);
    await click("Import selected completed result");
    expect(vi.mocked(fetch).mock.calls.slice(callsAtClear).map(row => row[0])).toEqual([
      "/api/auth/session", "/api/research/evidence-draft/completed-read/selection", "/api/research/evidence-draft/completed-read",
    ]);
    const fresh = await backup(); expect(fresh.reports).toHaveLength(1); expect(fresh.reports[0].id).toBe(id);
    expect(buildEvidenceDraft(fresh).excerpts).toHaveLength(1);
    expect(fresh.readingStatuses).toHaveLength(1); expect(fresh.readingStatuses[0].paperUrl).toBe(second.url);
    expect(fresh.readingStatuses[0].status).toBe("unavailable");
  });
  for (const phase of ["metadata", "import"] as const) it.each(["owner", "selection", "include", "unmount"])(`discards stale ${phase} after %s`, async change => {
    const endpoint = phase === "metadata" ? "/api/research/evidence-draft/completed-read/selection" : "/api/research/evidence-draft/completed-read";
    if (phase === "import") await select();
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (url, init) => url === endpoint ? new Promise<Response>(done => { resolve = done; }) : f.respond(String(url), init));
    if (phase === "metadata") await select(); else await click("Import selected completed result");
    const call = vi.mocked(fetch).mock.calls.at(-1)!, signal = call[1]!.signal!;
    if (change === "owner") await act(async () => { window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" })); });
    if (change === "selection") await fill(control<HTMLInputElement>(copy.jobId), `prv_${"d".repeat(64)}`);
    if (change === "include") { workspace = { ...workspace, entries: workspace.entries.map(row => ({ ...row, screening: "exclude" as const })) }; await render(); }
    if (change === "unmount") { await act(async () => { root!.unmount(); }); root = undefined; }
    expect(signal.aborted).toBe(true);
    const callsBeforeResolution = vi.mocked(fetch).mock.calls.length;
    await act(async () => { resolve(await f.respond(endpoint, call[1])); });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(callsBeforeResolution);
    if (root) { expect(button("Import selected completed result")).toBeUndefined(); expect((await backup()).reports).toHaveLength(0); }
  });
  it.each([401, 409, 503])("shows truthful %s unavailable explanation without making a result selectable", async status => {
    vi.mocked(fetch).mockImplementation(async (url, init) => url === "/api/research/evidence-draft/completed-read/selection"
      ? Response.json({}, { status }) : f.respond(String(url), init));
    await select(); expect(container.textContent).toContain(status === 503 ? copy.storage : status === 401 ? copy.signIn : copy.unavailable);
    expect(button("Import selected completed result")).toBeUndefined(); expect((await backup()).reports).toHaveLength(0);
  });
  it("does not perform a private read when explicit session lookup refuses, and bounds a stalled session lookup", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ session: null }, { status: 401 }));
    await select(); expect(container.textContent).toContain(copy.signIn); expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled();
    vi.useFakeTimers(); vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    await click(copy.read); await act(async () => { await vi.advanceTimersByTimeAsync(15001); });
    expect(container.textContent).toContain(copy.timedOut); expect(button(copy.read).disabled).toBe(false);
    expect(vi.mocked(fetch).mock.calls.every(row => row[0] === "/api/auth/session")).toBe(true);
  });
  it.each(["snapshot", "version", "saved-at"])("preserves pending edits when the selected retained %s changes before import", async change => {
    await select(); await fill(control<HTMLTextAreaElement>(editorCopy.claim.passage), "Keep pending edit.");
    if (change === "snapshot") f.run.answer += " Changed snapshot.";
    if (change === "version") {
      f.run.citations[0].contentVersion = `sha256:${"e".repeat(64)}`; f.run.evidence[0].contentVersion = f.run.citations[0].contentVersion;
    }
    if (change === "saved-at") f.db.getPrivateResearchResult.mockImplementation(async () => ({ id, format: "query-run-v1",
      savedAt: "2026-10-12T03:00:00.000Z", serializedRun: JSON.stringify(f.run) }));
    await click("Import selected completed result");
    const draft = await backup(); expect(draft.reports).toHaveLength(0); expect(draft.passage).toBe("Keep pending edit.");
  });
  it("rejects a response bound to a foreign origin or snapshot with a missing hash", async () => {
    for (const change of ["origin", "hash"] as const) {
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        const response = await f.respond(String(url), init);
        if (url !== "/api/research/evidence-draft/completed-read/selection") return response;
        const packet = await response.json();
        if (change === "origin") packet.baseUrl = "https://foreign.example"; else delete packet.selection.snapshotSha256;
        return Response.json(packet);
      });
      await select(); expect(container.textContent).toContain(copy.unavailable); expect(button("Import selected completed result")).toBeUndefined();
    }
  });
  it.each([false, true])("mounts mixed/all-unavailable observations without changing unrelated unread/unknown or pending prose (all: %s)", async all => {
    const entry = workspace.entries[0], second = PAPER_CATALOG[1], unrelated = PAPER_CATALOG[2], unknown = PAPER_CATALOG[3];
    workspace = { ...workspace, entries: [...workspace.entries, { ...entry, paper: second }, { ...entry, paper: unrelated }, { ...entry, paper: unknown }] };
    const identity = { sourceId: "original-b", itemId: "paper-b", itemUrl: second.url, marker: "S2" };
    f.run.citations.push({ ...f.run.citations[0], ...identity }); f.run.evidence.push({ ...f.run.evidence[0], ...identity, qualifiesForAnswer: false });
    f.run.decisions.push({ ...f.run.decisions[0], ...identity }); f.run.answer += " [S2]"; f.run.evidence[0].qualifiesForAnswer = !all;
    await render(); await fill(control<HTMLTextAreaElement>(editorCopy.claim.passage), "Keep human prose.");
    const observations = [...container.querySelectorAll("label")].filter(row => row.textContent?.trim().startsWith(editorCopy.reading.status));
    for (const row of observations.slice(0, 3)) await fill(row.querySelector<HTMLSelectElement>("select")!, "unread");
    await select(); await click("Import selected completed result");
    const draft = await backup(), built = buildEvidenceDraft(draft), exported = exportEvidenceDraft(draft);
    expect(draft.passage).toBe("Keep human prose."); expect(built.excerpts).toHaveLength(all ? 0 : 1);
    expect(draft.readingStatuses).toHaveLength(all ? 3 : 2);
    expect(draft.readingStatuses.find((row: { paperUrl: string }) => row.paperUrl === unrelated.url).status).toBe("unread");
    expect(draft.readingStatuses.some((row: { paperUrl: string }) => row.paperUrl === unknown.url)).toBe(false);
    for (const text of [exported.markdown, exported.latex]) expect(text).toContain("unavailable");
    expect(vi.mocked(fetch).mock.calls.map(row => row[0])).toEqual(["/api/auth/session", "/api/research/evidence-draft/completed-read/selection", "/api/research/evidence-draft/completed-read"]);
  });
});
