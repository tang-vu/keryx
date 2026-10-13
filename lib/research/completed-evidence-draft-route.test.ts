// @vitest-environment jsdom
// Route and real importer regressions with private in-memory data.
import { createHash } from "node:crypto";
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendCompletedEvidenceDraftImport, CompletedEvidenceDraftImport, type CompletedEvidenceDraftImportValue } from "../../components/keryx/completed-evidence-draft-import";
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { createCompletedEvidenceDraftRoute } from "./completed-evidence-draft-route";
import { loadCompletedEvidenceDraft, type CompletedEvidenceDraftRequest } from "./completed-evidence-draft";
import { buildEvidenceDraft, type EvidenceDraftRequest } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";
import { PAPER_CATALOG } from "../papers/catalog";

const wallet = `0x${"1".repeat(40)}`, id = `prv_${"a".repeat(64)}`, baseUrl = "https://keryx.cc", network = "eip155:5042";
function fixture() {
  const draft = evidenceDraftFixture(), original = draft.reports[0].evidence![0];
  const identity = { marker: original.marker, sourceId: original.sourceId, itemId: original.itemId!, itemUrl: original.itemUrl!,
    itemTitle: original.itemTitle, contentVersion: `sha256:${"b".repeat(64)}`, sourceName: "Original",
    contentReceipt: { bodyHash: `0x${"c".repeat(64)}`, deliveryKind: "full_text", storageMode: "db_plaintext", plaintextBytes: 200 } };
  const run = { id, question: "Read the exact original", budget: 0.05, researchMode: "deep", asker: wallet,
    paymentMode: "real", fundingOwner: "treasury", origin: "a2a", answer: "Retained result [S1].", engine: "fixture",
    createdAt: "2026-10-12T01:00:00.000Z", subClaims: [original.claim],
    decisions: [{ ...identity, action: "BUY", rationale: "Fixture read", targets: [0], price: 0.01 }],
    citations: [{ ...identity, weight: 1, reward: 0.001, rationale: "Fixture citation" }],
    evidence: [{ ...identity, claimIndex: 0, claim: original.claim, quote: original.quote, support: 0.8,
      qualifiesForAnswer: true, qualifiesForReward: false }], totalSpent: 0.011, receipt: { original: "PRESERVE_BYTES" } };
  let serializedRun = JSON.stringify(run); const savedAt = "2026-10-12T02:00:00.000Z";
  const intent = { id, submission: { request: { question: run.question, budget: run.budget, researchMode: run.researchMode },
    payment: { authorization: { from: wallet, nonce: "ORIGINAL_NONCE" }, signature: "ORIGINAL_SIGNATURE" } }, requirement: { network } } as unknown as PrivateResearchIntent;
  const db = { getPrivateResearchIntent: vi.fn(async () => intent),
    getPrivateResearchExecution: vi.fn(async () => ({ id, workerId: "12345678-1234-4234-8234-123456789abc", startedAt: "2026-10-12T00:00:00.000Z" })),
    getPrivateResearchInterruption: vi.fn(async () => null),
    getPrivateResearchResult: vi.fn(async () => ({ id, savedAt, format: "query-run-v1" as const, serializedRun })) };
  const input: CompletedEvidenceDraftRequest = { version: 1, capability: "owned-private-completed-read-v1", baseUrl, network,
    workspace: draft.workspace, selection: { id, savedAt, question: run.question, budget: run.budget, researchMode: "deep",
      snapshotSha256: `sha256:${createHash("sha256").update(serializedRun).digest("hex")}`,
      sources: [{ sourceId: identity.sourceId, itemId: identity.itemId, itemUrl: identity.itemUrl, contentVersion: identity.contentVersion }] } };
  const account = vi.fn(async () => ({ db, wallet })), context = { db, wallet, baseUrl, network };
  const resnapshot = () => { serializedRun = JSON.stringify(run); input.selection.snapshotSha256 = `sha256:${createHash("sha256").update(serializedRun).digest("hex")}`; };
  return { db, account, input, context, get serializedRun() { return serializedRun; }, intent, run, resnapshot };
}
const request = (body: unknown, extra: Record<string, string> = {}, url = "https://keryx.cc/api/research/evidence-draft/completed-read") =>
  new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: baseUrl,
    "X-Keryx-Expected-Owner": wallet, ...extra } });
const privateHeaders = (response: Response) => {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toContain("Cookie"); expect(response.headers.get("vary")).toContain("X-Keryx-Expected-Owner");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
};
let root: Root | undefined, container: HTMLDivElement | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); }); root = undefined; container?.remove(); container = undefined;
  vi.unstubAllGlobals(); vi.useRealTimers();
});
describe("completed private read HTTP boundary", () => {
  it("composes real owner reader, draft assembly and export gates without returning original money/receipt/answer bytes", async () => {
    const f = fixture(), response = await createCompletedEvidenceDraftRoute({ baseUrl, network, account: f.account })(request(f.input));
    expect(response.status).toBe(200); privateHeaders(response);
    const packet = await response.json(); expect(packet.draft.excerpts).toHaveLength(1); expect(packet.exports.referenceCount).toBe(1);
    expect(packet.provenance.semanticSupport).toBe("UNJUDGED"); expect(packet.provenance.expert).toBe(null);
    expect(JSON.stringify(packet)).not.toContain("ORIGINAL_NONCE"); expect(JSON.stringify(packet)).not.toContain("PRESERVE_BYTES");
    expect(f.db.getPrivateResearchResult).toHaveBeenCalledTimes(2);
    expect((await f.db.getPrivateResearchResult()).serializedRun).toBe(f.serializedRun);
  });
  it.each(["Bearer kx_live_" + "a".repeat(96), "Bearer bad", "", "Basic value"])("never lets authorization presence select cookie/result authority: %s", async authorization => {
    const f = fixture(), req = request(f.input, { Authorization: authorization });
    const response = await createCompletedEvidenceDraftRoute({ baseUrl, network, account: f.account })(req);
    expect(response.status).toBe(401); expect(req.bodyUsed).toBe(false); expect(f.account).not.toHaveBeenCalled();
    expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled(); privateHeaders(response);
  });
  it.each([{ Origin: "https://foreign.example" }, { Origin: "https://keryx.cc/" }, { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" }, { Origin: "http://keryx.cc", Host: "keryx.cc", "X-Forwarded-Host": "keryx.cc" }] as Array<Record<string, string>>)("checks configured origin before session and body: %j", async headers => {
    const f = fixture(), req = request(f.input, headers), response = await createCompletedEvidenceDraftRoute({ baseUrl, network, account: f.account })(req);
    expect(response.status).toBe(403); expect(req.bodyUsed).toBe(false); expect(f.account).not.toHaveBeenCalled(); privateHeaders(response);
  });
  it.each(["missing", "malformed", "different", "unauthenticated", "outage"])("refuses %s owner/session before body/result access", async change => {
    const f = fixture(), req = request(f.input);
    if (change === "missing") req.headers.delete("X-Keryx-Expected-Owner");
    if (change === "malformed") req.headers.set("X-Keryx-Expected-Owner", "owner");
    if (change === "different") req.headers.set("X-Keryx-Expected-Owner", `0x${"2".repeat(40)}`);
    if (change === "unauthenticated") f.account.mockResolvedValue(Response.json({ error: "SECRET" }, { status: 401 }) as never);
    if (change === "outage") f.account.mockRejectedValue(new Error("SECRET"));
    const response = await createCompletedEvidenceDraftRoute({ baseUrl, network, account: f.account })(req);
    expect(response.status).toBe(change === "outage" ? 503 : change === "unauthenticated" ? 401 : 403);
    expect(req.bodyUsed).toBe(false); expect(f.db.getPrivateResearchIntent).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("SECRET"); privateHeaders(response);
  });
  it("refuses URL selectors, non-POST, absent Origin, malformed baseURL and content type without private result reads", async () => {
    const f = fixture(), handler = createCompletedEvidenceDraftRoute({ baseUrl, network, account: f.account });
    for (const req of [request(f.input, {}, `https://keryx.cc/api/research/evidence-draft/completed-read?id=${id}`),
      new Request("https://keryx.cc/api/research/evidence-draft/completed-read", { method: "GET" }), request(f.input, { "Content-Type": "text/plain" })]) {
      expect((await handler(req)).status).toBe(400); expect(req.bodyUsed).toBe(false);
    }
    const noOrigin = request(f.input); noOrigin.headers.delete("Origin"); expect((await handler(noOrigin)).status).toBe(403);
    expect((await createCompletedEvidenceDraftRoute({ baseUrl: "https://keryx.cc?unsafe", network, account: f.account })(request(f.input))).status).toBe(403);
    expect(f.db.getPrivateResearchIntent).not.toHaveBeenCalled();
  });
  it("bounds chunked bodies, malformed UTF8/JSON and forged caller input with fixed private failures", async () => {
    const f = fixture(), handler = createCompletedEvidenceDraftRoute({ baseUrl, network, account: f.account });
    for (const data of [new Uint8Array([0xff]), new TextEncoder().encode("{SECRET"), new Uint8Array(65537)]) {
      const req = request({}); const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } });
      Object.defineProperty(req, "body", { value: body });
      const response = await handler(req); expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_completed_read_request" }); privateHeaders(response);
    }
    for (const value of [{ ...f.input, reports: evidenceDraftFixture().reports }, { ...f.input, callerOwner: wallet }, { ...f.input, sourceReadStatus: "completed" }]) {
      const response = await handler(request(value)); expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "completed_read_unavailable_or_changed" });
    }
    expect(f.db.getPrivateResearchIntent).not.toHaveBeenCalled();
  });
  it("closes a stalled body deadline without extending it for hostile cancellation", async () => {
    const f = fixture(); vi.useFakeTimers(); const req = request({});
    Object.defineProperty(req, "body", { value: new ReadableStream({ cancel: () => new Promise(() => {}) }) });
    const promise = createCompletedEvidenceDraftRoute({ baseUrl, network, account: f.account })(req);
    await vi.advanceTimersByTimeAsync(5001); const response = await promise;
    expect(response.status).toBe(400); expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled();
  });
  it("fails selected storage without result/public/archive repair or private error details", async () => {
    const f = fixture(); f.db.getPrivateResearchExecution.mockRejectedValue(new Error("SECRET_DB_PROVIDER_DETAILS"));
    const response = await createCompletedEvidenceDraftRoute({ baseUrl, network, account: f.account })(request(f.input));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "completed_read_storage_unavailable" });
    expect(f.db.getPrivateResearchResult).not.toHaveBeenCalled(); privateHeaders(response);
  });
});

async function mount(f: ReturnType<typeof fixture>, onImport: (value: CompletedEvidenceDraftImportValue) => boolean, owner: string | null = wallet) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(CompletedEvidenceDraftImport, { currentOwner: owner, selection: f.input.selection,
    workspace: f.input.workspace, baseUrl: f.input.baseUrl, network, onImport })); });
}
type Editors = Pick<EvidenceDraftRequest, "reports" | "passage" | "claims" | "themes" | "readingStatuses">;
const initialEditor = (): Editors => ({ passage: "Unsaved prose", claims: [], reports: [],
  themes: [{ id: "theme1", title: "Author theme", authorNote: "Preserve note", excerptIds: [], statements: [
    { id: "statement1", kind: "gap", text: "Author gap", paperUrls: [], excerptIds: [] },
    { id: "statement2", kind: "gap", text: "", paperUrls: [], excerptIds: [] },
  ] }],
});
async function mountEditor(f: ReturnType<typeof fixture>, initial: Editors) {
  function EditorHost() {
    const [editor, setEditor] = useState(initial), live = useRef(editor); live.current = editor;
    return createElement("div", null,
      createElement(CompletedEvidenceDraftImport, { currentOwner: wallet, selection: f.input.selection,
        workspace: f.input.workspace, baseUrl: f.input.baseUrl, network, onImport: value => {
          try {
            const next = appendCompletedEvidenceDraftImport(live.current, f.input.workspace, value);
            live.current = next; setEditor(next); return true;
          } catch { return false; }
        } }), createElement("output", null, JSON.stringify(editor)));
  }
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(EditorHost)); });
}
function mixedFixture(allUnavailable: boolean) {
  const f = fixture(), entry = f.input.workspace.entries[0], second = PAPER_CATALOG[1], secondUrl = second.url;
  f.input.workspace.entries.push({ ...entry, paper: second });
  const identity = { ...f.run.citations[0], marker: "S2", sourceId: "original-b", itemId: "paper-b", itemUrl: secondUrl };
  f.run.citations.push(identity);
  f.run.evidence.push({ ...f.run.evidence[0], marker: identity.marker, sourceId: identity.sourceId,
    itemId: identity.itemId, itemUrl: secondUrl, qualifiesForAnswer: false });
  f.run.decisions.push({ ...f.run.decisions[0], ...identity });
  f.run.answer += " [S2]";
  f.run.evidence[0].qualifiesForAnswer = !allUnavailable;
  f.input.selection.sources.push({ sourceId: identity.sourceId, itemId: identity.itemId, itemUrl: secondUrl, contentVersion: identity.contentVersion });
  f.resnapshot(); f.input.baseUrl = window.location.origin; f.context.baseUrl = window.location.origin;
  return f;
}
describe("standalone private completed importer", () => {
  it.each([false, true])("merges mixed/all-unavailable observations into current editor and exports (all unavailable: %s)", async allUnavailable => {
    const f = mixedFixture(allUnavailable), entry = f.input.workspace.entries[0];
    const unrelatedUrl = PAPER_CATALOG[2].url, unknownUrl = PAPER_CATALOG[3].url;
    for (const paper of [PAPER_CATALOG[2], PAPER_CATALOG[3]]) f.input.workspace.entries.push({ ...entry, paper });
    const initial = initialEditor();
    initial.readingStatuses = [
      { paperUrl: entry.paper.url, status: "unread", reason: "Earlier observation" },
      { paperUrl: f.input.selection.sources[1].itemUrl, status: "unread", reason: "Earlier observation B" },
      { paperUrl: unrelatedUrl, status: "unread", reason: "Unrelated observation" },
    ];
    const packet = await loadCompletedEvidenceDraft(f.context, f.input);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(packet))); await mountEditor(f, initial);
    await act(async () => { container!.querySelector("button")!.click(); });
    const editor: Editors = JSON.parse(container!.querySelector("output")!.textContent!);
    expect(editor.passage).toBe(initial.passage); expect(editor.claims).toEqual(initial.claims); expect(editor.themes).toEqual(initial.themes);
    expect(editor.reports).toHaveLength(1);
    expect(editor.readingStatuses).toContainEqual({ paperUrl: unrelatedUrl, status: "unread", reason: "Unrelated observation" });
    const request: EvidenceDraftRequest = { version: 1, scope: "private-evidence-draft", workspace: f.input.workspace,
      ...editor, themes: editor.themes.map(theme => ({ ...theme, statements: theme.statements?.filter(row => row.text.trim()) })) };
    const draft = buildEvidenceDraft(request), exports = exportEvidenceDraft(request);
    expect(draft.excerpts).toHaveLength(allUnavailable ? 0 : 1);
    expect(draft.reading.unavailable.map(row => row.paper.url)).toEqual(allUnavailable ? f.input.selection.sources.map(row => row.itemUrl) : [f.input.selection.sources[1].itemUrl]);
    expect(draft.reading.unknown.map(row => row.paper.url)).toEqual([unknownUrl]);
    expect(draft.reading.unread.map(row => row.paper.url)).toEqual([unrelatedUrl]);
    for (const format of ["markdown", "latex"] as const) {
      expect(exports[format]).toContain("No eligible version-bound retained body excerpt is available.");
    }
    if (allUnavailable) expect(container!.textContent).toContain("no usable exact retained excerpts");
  });
  it.each(["capacity", "duplicate"])("refuses actual current-editor %s without changing any edit or observation", async refusal => {
    const f = mixedFixture(false), initial = initialEditor();
    initial.reports = refusal === "capacity" ? Array.from({ length: 8 }, (_, index) => ({ id: `retained${index}`, subClaims: [], citations: [] }))
      : [{ id: f.input.selection.id, subClaims: [], citations: [] }];
    initial.readingStatuses = [{ paperUrl: f.input.selection.sources[1].itemUrl, status: "unread", reason: "Preserve observation" }];
    const packet = await loadCompletedEvidenceDraft(f.context, f.input);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(packet))); await mountEditor(f, initial);
    await act(async () => { container!.querySelector("button")!.click(); });
    expect(JSON.parse(container!.querySelector("output")!.textContent!)).toEqual(initial);
    expect(container!.textContent).toContain("Your draft is preserved");
  });
  it("preserves an existing retained excerpt when the selected completion has an unavailable observation", async () => {
    const f = mixedFixture(true), current = initialEditor(); current.reports = evidenceDraftFixture().reports;
    const packet = await loadCompletedEvidenceDraft(f.context, f.input);
    const next = appendCompletedEvidenceDraftImport(current, f.input.workspace, {
      report: packet.editableRequest.reports[0], readingStatuses: packet.editableRequest.readingStatuses ?? [],
    });
    expect(next.readingStatuses?.map(row => row.paperUrl)).toEqual([f.input.selection.sources[1].itemUrl]);
    expect(next.themes).toBe(current.themes); expect(next.claims).toBe(current.claims);
  });
  it("does no automatic read, sends selectors only by explicit POST, and appends without replacing draft edits", async () => {
    const f = fixture(); f.input.baseUrl = window.location.origin; f.context.baseUrl = window.location.origin;
    const packet = await loadCompletedEvidenceDraft(f.context, f.input);
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    const imported = vi.fn();
    function EditorHost() {
      const [editor, setEditor] = useState<Pick<EvidenceDraftRequest, "reports" | "passage" | "claims" | "themes" | "readingStatuses">>({
        passage: "Unsaved passage", claims: [], reports: [],
        themes: [{ id: "theme1", title: "Methods", authorNote: "Author note", excerptIds: [], statements: [
          { id: "statement1", kind: "contribution", text: "Written author sentence", paperUrls: [], excerptIds: [] },
          { id: "statement2", kind: "gap", text: "", paperUrls: [], excerptIds: [] },
        ] }],
      });
      const live = useRef(editor); live.current = editor;
      return createElement("div", null,
        createElement(CompletedEvidenceDraftImport, { currentOwner: wallet, selection: f.input.selection, workspace: f.input.workspace,
          baseUrl: f.input.baseUrl, network, onImport: value => {
            try {
              const next = appendCompletedEvidenceDraftImport(live.current, f.input.workspace, value);
              imported(value); live.current = next; setEditor(next); return true;
            } catch { return false; }
          } }),
        createElement("button", { onClick: () => setEditor(current => ({ ...current, passage: "Edited while waiting",
          themes: current.themes.map(theme => ({ ...theme, authorNote: "Theme edit retained" })) })) }, "Keep editing"),
        createElement("output", { "data-editor": true }, JSON.stringify(editor)));
    }
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => { root!.render(createElement(EditorHost)); }); expect(fetcher).not.toHaveBeenCalled();
    await act(async () => { container!.querySelector("button")!.click(); });
    await act(async () => { [...container!.querySelectorAll("button")].find(row => row.textContent === "Keep editing")!.click(); });
    await act(async () => { resolve(Response.json(packet)); });
    expect(fetcher).toHaveBeenCalledTimes(1); const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/research/evidence-draft/completed-read"); expect(url).not.toContain(id);
    expect(options.method).toBe("POST"); expect(options.cache).toBe("no-store"); expect(options.credentials).toBe("same-origin");
    expect(options.body).toContain(id); expect(options.body).not.toContain("Edited while waiting");
    expect(imported).toHaveBeenCalledTimes(1);
    const editor = JSON.parse(container!.querySelector("output")!.textContent!);
    expect(editor.passage).toBe("Edited while waiting"); expect(editor.themes[0].authorNote).toBe("Theme edit retained"); expect(editor.reports).toHaveLength(1);
    expect(editor.themes[0].statements.map((row: { text: string }) => row.text)).toEqual(["Written author sentence", ""]);
    expect(container!.textContent).toContain("Semantic support is unjudged");
  });
  it.each(["owner", "include", "selection", "unmount"])("discards a late response after %s changes", async change => {
    const f = fixture(); f.input.baseUrl = window.location.origin; f.context.baseUrl = window.location.origin;
    const packet = await loadCompletedEvidenceDraft(f.context, f.input); let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const imported = vi.fn(() => true); await mount(f, imported);
    await act(async () => { container!.querySelector("button")!.click(); });
    if (change === "unmount") { await act(async () => { root!.unmount(); }); root = undefined; }
    else {
      const workspace = structuredClone(f.input.workspace);
      if (change === "include") workspace.entries[0].screening = "exclude";
      await act(async () => { root!.render(createElement(CompletedEvidenceDraftImport, {
        currentOwner: change === "owner" ? `0x${"2".repeat(40)}` : wallet,
        selection: change === "selection" ? { ...f.input.selection, savedAt: "2026-10-12T03:00:00.000Z" } : f.input.selection,
        workspace, baseUrl: f.input.baseUrl, network, onImport: imported })); });
    }
    await act(async () => { resolve(Response.json(packet)); }); expect(imported).not.toHaveBeenCalled();
  });
  it("keeps import unavailable without an owner or retained selection", async () => {
    const f = fixture(), fetcher = vi.fn(), imported = vi.fn(() => true); vi.stubGlobal("fetch", fetcher);
    await mount(f, imported, null); expect(container!.querySelector("button")!.disabled).toBe(true);
    await act(async () => { root!.render(createElement(CompletedEvidenceDraftImport, { currentOwner: wallet, selection: null,
      workspace: f.input.workspace, baseUrl: f.input.baseUrl, network, onImport: imported })); });
    expect(container!.querySelector("button")!.disabled).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["unread", "foreign", "duplicate", "too-many"])("rejects forged response observation %s before editor changes", async change => {
    const f = mixedFixture(true), packet = await loadCompletedEvidenceDraft(f.context, f.input);
    const row = packet.editableRequest.readingStatuses![0];
    if (change === "unread") row.status = "unread";
    if (change === "foreign") row.paperUrl = "https://papers.example/foreign";
    if (change === "duplicate") packet.editableRequest.readingStatuses!.push({ ...row });
    if (change === "too-many") packet.editableRequest.readingStatuses = Array.from({ length: 51 }, () => ({ ...row }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(packet))); const imported = vi.fn(() => true); await mount(f, imported);
    await act(async () => { container!.querySelector("button")!.click(); });
    expect(imported).not.toHaveBeenCalled(); expect(container!.textContent).toContain("Your draft is preserved");
  });
  it("leaves the editor untouched when callback capacity refuses or response identity changes", async () => {
    const f = fixture(); f.input.baseUrl = window.location.origin; f.context.baseUrl = window.location.origin;
    const packet = await loadCompletedEvidenceDraft(f.context, f.input), imported = vi.fn(() => false);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(packet))); await mount(f, imported);
    await act(async () => { container!.querySelector("button")!.click(); });
    expect(imported).toHaveBeenCalledTimes(1); expect(container!.textContent).toContain("Your draft is preserved");
    imported.mockClear(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...packet, wallet: `0x${"2".repeat(40)}` })));
    await act(async () => { container!.querySelector("button")!.click(); }); expect(imported).not.toHaveBeenCalled();
  });
});
