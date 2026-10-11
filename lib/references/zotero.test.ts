import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqliteZotero } from "../db/zotero-sqlite";
import { PAPER_CATALOG } from "../papers/catalog";
import { paperReferencesBibtex, paperReferencesCslJson } from "../papers/reference-export";
import { buildCitationExport } from "../research-citation-export";
import type { Citation, QueryRun } from "../types";
import { createZoteroService } from "./zotero-service";
import { digest, zoteroPaperReferences, zoteroReportReferences } from "./zotero-export";
import type { ZoteroItem } from "./zotero-provider";
import { createZoteroRoutes } from "./zotero-routes";
import type { KeryxDB } from "../db/keryx-db";
import { encryptContent } from "../ipfs/content-crypto";
const owner = `0x${"a".repeat(40)}`, token = "SYNTHETICKEY000000000001", collection = "ABCD2345";
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllEnvs(); });
function syntheticZotero() {
  const items = new Map<string, ZoteroItem>(), calls: Array<{ url: string; method: string; body?: Record<string, unknown>[]; headers: Headers }> = [];
  let version = 1;
  const state = { dropped: false, failIndex: -1, scopes: { library: true, notes: true, write: true, files: false }, groups: {} as Record<string, unknown>, backoff: "", total: 0, changeVersion: false };
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined, headers = new Headers(init?.headers);
    calls.push({ url: String(input), method, body, headers });
    if (url.origin !== "https://api.zotero.org" || headers.get("Zotero-API-Key") !== token || init?.redirect !== "error" || init?.credentials !== "omit" || url.searchParams.has("key")) throw new Error(`secret ${token}`);
    const responseHeaders = { "Last-Modified-Version": String(state.changeVersion ? ++version : version), ...(state.backoff ? { Backoff: state.backoff } : {}) };
    if (url.pathname === "/keys/current") return Response.json({ userID: 1234, access: { user: state.scopes, groups: state.groups } }, { headers: responseHeaders });
    if (url.pathname === "/users/1234/collections") return Response.json([{ key: collection, data: { name: "Selected synthetic collection" } }], { headers: { ...responseHeaders, "Total-Results": "1" } });
    if (url.pathname === "/users/1234/items" && method === "GET") {
      const rows = [...items.values()], start = Number(url.searchParams.get("start"));
      return Response.json(rows.slice(start, start + 100), { headers: { ...responseHeaders, "Total-Results": String(state.total || rows.length) } });
    }
    if (url.pathname === "/users/1234/items" && method === "POST") {
      const successful: Record<string, unknown> = {}, failed: Record<string, unknown> = {}; version++;
      for (const [index, fields] of (body as Record<string, unknown>[]).entries()) {
        const key = String(fields.key), previous = items.get(key);
        if (index === state.failIndex || previous && fields.version !== previous.version || !previous && fields.version !== 0) { failed[String(index)] = { message: `private upstream ${token}`, code: 412 }; continue; }
        const data = { ...(previous?.data ?? {}), ...fields, version } as ZoteroItem["data"], item = { key, version, data };
        items.set(key, item); successful[String(index)] = item;
      }
      if (state.dropped) { state.dropped = false; throw new Error(`ambiguous write ${token}`); }
      return Response.json({ successful, unchanged: {}, failed }, { headers: responseHeaders });
    }
    throw new Error("Unexpected synthetic request");
  });
  return { items, calls, state, transport };
}
function fixture() {
  vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  const db = new DatabaseSync(":memory:"); databases.push(db); installSqliteApplicationSchema(db);
  const store = createSqliteZotero(db), provider = syntheticZotero(); return { db, store, provider, service: createZoteroService(store, provider.transport) };
}
const refs = () => zoteroPaperReferences([PAPER_CATALOG[0]]);
function held() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
function sharedLibrary() {
  vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  // Two real SQLite connections/stores, one isolated retained file, one provider.
  const artifacts = join(process.cwd(), ".artifacts");
  mkdirSync(artifacts, { recursive: true });
  const path = join(mkdtempSync(join(artifacts, "zotero-reviewfix-db-")), "synthetic.sqlite");
  const first = new DatabaseSync(path), second = new DatabaseSync(path); databases.push(first, second);
  installSqliteApplicationSchema(first);
  return { first: createSqliteZotero(first), second: createSqliteZotero(second), provider: syntheticZotero(), db: first };
}
describe("explicit Zotero references", () => {
  it("admits only one of two wallets connecting concurrently to one library through separate stores", async () => {
    const f = sharedLibrary(), other = `0x${"b".repeat(40)}`, seen = [held(), held()], response = [held(), held()]; let permission = 0;
    const transport: typeof fetch = async (input, init) => {
      const value = await f.provider.transport(input, init);
      if (String(input).endsWith("/keys/current")) { const index = permission++; seen[index].open(); await response[index].promise; }
      return value;
    };
    const first = createZoteroService(f.first, transport), second = createZoteroService(f.second, transport);
    const connecting = first.connect(owner, token); await seen[0].promise;
    const competing = second.connect(other, token); const rejected = expect(competing).rejects.toThrow("zotero_library_bound"); await seen[1].promise;
    response[0].open(); await connecting; response[1].open(); await rejected;
    expect(await second.status(other)).toEqual({ connected: false, userId: null });
    await expect(second.send(other, collection, refs())).rejects.toThrow("zotero_disconnected");
    expect(f.provider.calls.filter(call => call.method === "POST")).toHaveLength(0);
    expect(f.db.prepare("SELECT wallet FROM zotero_library_owners WHERE user_id='1234'").get()?.wallet).toBe(owner);
  });
  it.each(["accepted", "pending"])("retains the one-wallet binding across held snapshots, %s ambiguous writes and revoke/reconnect", async acceptance => {
    const f = sharedLibrary(), other = `0x${"b".repeat(40)}`, readSeen = held(), readResponse = held(), writeSeen = held(), writeResponse = held();
    let holdRead = true, holdWrite = true;
    const transport: typeof fetch = async (input, init) => {
      const heldWrite = init?.method === "POST" && holdWrite;
      if (heldWrite) {
        holdWrite = false;
        if (acceptance === "pending") { writeSeen.open(); await writeResponse.promise; }
      }
      const response = await f.provider.transport(input, init);
      if (String(input).includes("/items?") && holdRead) { holdRead = false; readSeen.open(); await readResponse.promise; }
      if (heldWrite) {
        if (acceptance === "accepted") { writeSeen.open(); await writeResponse.promise; }
        throw new Error(`lost synthetic response ${token}`);
      }
      return response;
    };
    const first = createZoteroService(f.first, transport), second = createZoteroService(f.second, transport);
    await first.connect(owner, token);
    const reading = first.send(owner, collection, refs()), revokedRead = expect(reading).rejects.toThrow("zotero_disconnected"); await readSeen.promise;
    await expect(second.connect(other, token)).rejects.toThrow("zotero_library_bound");
    await first.revoke(owner); await expect(second.connect(other, token)).rejects.toThrow("zotero_library_bound");
    await second.connect(owner, token); readResponse.open(); await revokedRead;
    expect(f.provider.calls.filter(call => call.method === "POST")).toHaveLength(0);
    const writing = first.send(owner, collection, refs()), ambiguous = expect(writing).rejects.toThrow("zotero_provider"); await writeSeen.promise;
    expect(f.provider.items.size).toBe(acceptance === "accepted" ? 2 : 0);
    await first.revoke(owner); await expect(second.connect(other, token)).rejects.toThrow("zotero_library_bound");
    await second.connect(owner, token); expect(await second.send(owner, collection, refs())).toMatchObject({ writes: acceptance === "accepted" ? 0 : 2 });
    const accepted = [...f.provider.items.keys()]; expect(accepted).toHaveLength(2);
    writeResponse.open(); await ambiguous;
    expect(await second.send(owner, collection, refs())).toMatchObject({ writes: 0 });
    expect([...f.provider.items.keys()]).toEqual(accepted);
    const writes = f.provider.calls.filter(call => call.method === "POST");
    expect(writes).toHaveLength(acceptance === "accepted" ? 1 : 2);
    if (writes.length === 2) expect(writes[0].body!.map(row => row.key)).toEqual(writes[1].body!.map(row => row.key));
    expect(await second.status(other)).toEqual({ connected: false, userId: null });
  });
  it("refuses a canonical report's distinct source/item identities sharing URL/version before every POST", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    const citation: Citation = { marker: "S1", sourceId: "one", sourceName: "Publisher", itemId: "one", itemTitle: "Canonical work", itemUrl: "https://source.example/shared", contentVersion: "sha256:one", weight: 1, reward: 0, rationale: "synthetic" };
    const citations = [citation, { ...citation, marker: "S2", sourceId: "two", itemId: "two" }];
    const references = zoteroReportReferences({ id: "alias-report", citations, evidence: [] } as unknown as QueryRun, "https://keryx.example");
    expect(references).toHaveLength(2); expect(new Set(references.map(row => row.identity)).size).toBe(2);
    expect(new Set(references.map(row => row.citationKey)).size).toBe(2);
    expect(JSON.parse(buildCitationExport(citations, "csl-json").content)).toHaveLength(2);
    for (const rows of [references, references.slice().reverse()]) await expect(f.service.send(owner, collection, rows)).rejects.toThrow("zotero_conflict");
    expect(f.provider.calls.filter(call => call.method === "POST")).toHaveLength(0); expect(f.provider.items.size).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM zotero_reference_keys").get()?.n).toBe(0);
  });
  it("keeps distinct canonical report content versions on one URL independently repeat-safe", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    const citation: Citation = { marker: "S1", sourceId: "source", sourceName: "Publisher", itemId: "work", itemTitle: "Canonical work", itemUrl: "https://source.example/shared", contentVersion: "sha256:one", weight: 1, reward: 0, rationale: "synthetic" };
    const references = zoteroReportReferences({ id: "version-report", citations: [citation, { ...citation, marker: "S2", contentVersion: "sha256:two" }], evidence: [] } as unknown as QueryRun, "https://keryx.example");
    expect(await f.service.send(owner, collection, references)).toMatchObject({ references: 2, writes: 4 });
    expect(await f.service.send(owner, collection, references.slice().reverse())).toMatchObject({ writes: 0 });
    const parents = [...f.provider.items.values()].filter(row => row.data.itemType !== "note");
    expect(parents.map(row => row.data.citationKey).sort()).toEqual(references.map(row => row.citationKey).sort());
    expect(parents.map(row => row.data.extra)).toEqual(references.map(row => row.fields.extra));
    expect(f.provider.items.size).toBe(4);
  });
  it("preserves exact saved arXiv v1/v2 identities sharing a DOI across initial and separate repeated sends", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    const papers = [1, 2].map(version => ({ ...PAPER_CATALOG[0], repository: "arxiv" as const, publicationKind: "preprint" as const, arxivId: `2401.12345v${version}`,
      url: `https://arxiv.org/abs/2401.12345v${version}`, metadataUrl: `https://arxiv.org/abs/2401.12345v${version}`, doi: "10.1234/shared" }));
    const references = zoteroPaperReferences(papers);
    expect(references[0].fields.extra).toContain("Archive location: 2401.12345v1");
    expect(references[1].fields.extra).toContain("Archive location: 2401.12345v2");
    expect(await f.service.send(owner, collection, references)).toMatchObject({ writes: 4 });
    for (const reference of references.slice().reverse()) expect(await f.service.send(owner, collection, [reference])).toMatchObject({ writes: 0 });
    expect(f.provider.items.size).toBe(4);
    const parents = [...f.provider.items.values()].filter(row => row.data.itemType !== "note");
    expect(parents.map(row => row.data.url)).toEqual(papers.map(row => row.url));
    expect(parents.map(row => row.data.citationKey)).toEqual(references.map(row => row.citationKey));
  });
  it("uses canonical fields, stable citation keys and a literal metadata provenance note", () => {
    const papers = PAPER_CATALOG.slice(0, 4), rows = JSON.parse(paperReferencesCslJson(papers).content), bib = paperReferencesBibtex(papers).content;
    for (const [index, ref] of zoteroPaperReferences(papers).entries()) {
      const row = rows[index]; expect(ref.fields).toMatchObject({ title: row.title, url: row.URL, citationKey: row.id });
      expect(bib).toContain(`${row.id},`); expect(ref.fields.creators).toEqual(row.author.map((author: { literal: string }) => ({ creatorType: "author", name: author.literal })));
      if (row.DOI) expect(ref.fields.DOI).toBe(row.DOI);
      if (row.issued) expect(ref.fields.date).toBe(String(row.issued["date-parts"][0][0]));
      if (row.archive_location) expect(ref.fields.extra).toContain(`Archive location: ${row.archive_location}`);
      expect(ref.note).toContain("metadata only"); expect(ref.note).not.toContain("Keryx report:");
    }
    expect(zoteroPaperReferences(papers.slice().reverse()).map(row => row.identity).reverse()).toEqual(zoteroPaperReferences(papers).map(row => row.identity));
  });
  it("keeps report BibTeX fields and exact version-bound cited quotes, escaped as literal HTML", () => {
    const citation: Citation = { marker: "S1", sourceId: "source", sourceName: "Publisher", itemId: "work", itemTitle: "Title & literal", itemUrl: "https://source.example/item", contentVersion: "sha256:one", weight: 1, reward: 0, rationale: "synthetic" };
    const quote = 'Exact  two spaces\n<script>literal</script> & "quote"';
    const run = { id: "report-one", citations: [citation], evidence: [{ ...citation, quote, qualifiesForAnswer: true }, { ...citation, contentVersion: "sha256:other", quote: "OTHER VERSION", qualifiesForAnswer: true }, { ...citation, quote: "UNCITED", qualifiesForAnswer: false, qualifiesForReward: false }] } as unknown as QueryRun;
    const [ref] = zoteroReportReferences(run, "https://keryx.example");
    expect(ref.fields.title).toBe("Title & literal"); expect(ref.fields.extra).toContain("Content version: sha256:one");
    expect(buildCitationExport(run.citations, "bibtex").content).toContain(`${ref.citationKey},`);
    expect(ref.note).toContain("https://keryx.example/dispatch/report-one"); expect(ref.note).toContain("Exact  two spaces\n&lt;script&gt;literal&lt;/script&gt; &amp; &quot;quote&quot;");
    expect(ref.note).not.toMatch(/OTHER VERSION|UNCITED|<script>/);
    expect(() => zoteroReportReferences({ ...run, originalFulfillment: {} } as QueryRun, "https://keryx.example")).toThrow("zotero_report_not_found");
  });
  it("stores encrypted owner-bound keys, performs no mount-time provider action and revokes locally", async () => {
    const f = fixture(); expect(await f.service.status(owner)).toEqual({ connected: false, userId: null }); expect(f.provider.calls).toEqual([]);
    await f.service.connect(owner, token); const persisted = JSON.stringify(f.db.prepare("SELECT * FROM zotero_connections").all());
    expect(persisted).not.toContain(token); expect(persisted).toContain("cipherB64"); expect(JSON.stringify(await f.service.status(owner))).not.toMatch(/cipher|token|apiKey/);
    await expect(f.service.collections(`0x${"b".repeat(40)}`)).rejects.toThrow("zotero_disconnected");
    await f.service.revoke(owner); expect(JSON.stringify(f.db.prepare("SELECT * FROM zotero_connections").all())).not.toContain("cipherB64");
    const count = f.provider.calls.length; await expect(f.service.send(owner, collection, refs())).rejects.toThrow("zotero_disconnected"); expect(f.provider.calls).toHaveLength(count);
  });
  it("reconciles repeated sends across disconnect and reconnect without duplicated references or notes", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    expect(await f.service.send(owner, collection, refs())).toMatchObject({ references: 1, writes: 2 });
    expect(await f.service.send(owner, collection, refs())).toMatchObject({ writes: 0 });
    const keys = [...f.provider.items.keys()]; await f.service.revoke(owner); await f.service.connect(owner, token);
    expect(await f.service.send(owner, collection, refs())).toMatchObject({ writes: 0 }); expect([...f.provider.items.keys()]).toEqual(keys);
    expect(f.provider.calls.filter(call => call.method === "POST")).toHaveLength(1);
  });
  it("reconciles an ambiguously accepted write using durable keys without a retry in the failing action", async () => {
    const f = fixture(); await f.service.connect(owner, token); f.provider.state.dropped = true;
    await expect(f.service.send(owner, collection, refs())).rejects.toThrow("zotero_provider"); expect(f.provider.items.size).toBe(2);
    expect(f.provider.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(await f.service.send(owner, collection, refs())).toMatchObject({ writes: 0 }); expect(f.provider.items.size).toBe(2);
  });
  it("does not report a partially failed 200 as success, and reconciles the accepted parent", async () => {
    const f = fixture(); await f.service.connect(owner, token); f.provider.state.failIndex = 1;
    await expect(f.service.send(owner, collection, refs())).rejects.toThrow("zotero_conflict"); expect(f.provider.items.size).toBe(1);
    f.provider.state.failIndex = -1; expect(await f.service.send(owner, collection, refs())).toMatchObject({ writes: 1 }); expect(f.provider.items.size).toBe(2);
  });
  it("adopts an identical existing library reference and preserves other collection memberships and notes", async () => {
    const f = fixture(), ref = refs()[0]; await f.service.connect(owner, token);
    const fields = { ...ref.fields, key: "ZZZZ2345", version: 1, citationKey: "", extra: "User metadata", collections: ["QTHER234"] };
    f.provider.items.set("ZZZZ2345", { key: "ZZZZ2345", version: 1, data: fields as ZoteroItem["data"] });
    await f.service.send(owner, collection, [ref]);
    expect(f.provider.items.size).toBe(2); expect(f.provider.items.get("ZZZZ2345")!.data.collections).toEqual(["QTHER234", collection]);
    expect(f.provider.items.get("ZZZZ2345")!.data.extra).toContain("User metadata");
    expect(await f.service.send(owner, collection, [ref])).toMatchObject({ writes: 0 });
  });
  it.each(["duplicate", "mismatch", "trashed", "collision"])("withholds all writes for %s library state", async kind => {
    const f = fixture(), ref = refs()[0]; await f.service.connect(owner, token);
    const data = { ...ref.fields, key: "ZZZZ2345", version: 1, collections: [], ...(kind === "mismatch" ? { title: "Conflicting title" } : {}), ...(kind === "trashed" ? { deleted: 1 } : {}) } as ZoteroItem["data"];
    f.provider.items.set("ZZZZ2345", { key: "ZZZZ2345", version: 1, data });
    if (kind === "duplicate") f.provider.items.set("YYYY2345", { key: "YYYY2345", version: 1, data: { ...data, key: "YYYY2345" } });
    if (kind === "collision") { const lease = await f.store.acquire(owner, true); await f.store.key(lease, "1234", ref.identity, "XXXX2345"); await f.store.release(lease); }
    await expect(f.service.send(owner, collection, [ref])).rejects.toThrow("zotero_conflict"); expect(f.provider.calls.some(call => call.method === "POST")).toBe(false);
  });
  it.each(["group", "file", "write", "notes"])("rejects excessive or missing %s permissions without storing the key", async kind => {
    const f = fixture(); if (kind === "group") f.provider.state.groups = { all: { library: true } }; else f.provider.state.scopes[kind === "file" ? "files" : kind as "write" | "notes"] = kind === "file";
    await expect(f.service.connect(owner, token)).rejects.toThrow("zotero_scopes"); expect(await f.store.status(owner)).toEqual({ connected: false, userId: null });
  });
  it("persists successful Backoff and prevents subsequent requests, including after disconnect", async () => {
    const f = fixture(); await f.service.connect(owner, token); f.provider.state.backoff = "60";
    await expect(f.service.send(owner, collection, refs())).rejects.toThrow("zotero_backoff"); const count = f.provider.calls.length;
    await f.service.revoke(owner); await expect(f.service.connect(owner, token)).rejects.toThrow("zotero_backoff"); expect(f.provider.calls).toHaveLength(count);
    await expect(f.service.connect(`0x${"b".repeat(40)}`, token)).rejects.toThrow("zotero_backoff"); expect(f.provider.calls).toHaveLength(count);
  });
  it("withholds writes to a library exceeding the bounded complete scan", async () => {
    const f = fixture(); await f.service.connect(owner, token); f.provider.state.total = 1001;
    await expect(f.service.send(owner, collection, refs())).rejects.toThrow("zotero_limit"); expect(f.provider.calls.some(call => call.method === "POST")).toBe(false);
  });
  it("invalidates an in-flight lease on revocation before any further provider write", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    const transport: typeof fetch = async (input, init) => { const response = await f.provider.transport(input, init); if (String(input).includes("/items?")) await f.service.revoke(owner); return response; };
    await expect(createZoteroService(f.store, transport).send(owner, collection, refs())).rejects.toThrow("zotero_disconnected");
    expect(f.provider.calls.some(call => call.method === "POST")).toBe(false);
  });
  it("does not expose keys through transport errors or missing encryption configuration", async () => {
    const f = fixture(), broken = createZoteroService(f.store, vi.fn(async () => { throw new Error(token); }));
    await expect(broken.connect(owner, token)).rejects.toThrow("zotero_provider"); vi.stubEnv("CONTENT_MASTER_KEY", "");
    const count = f.provider.calls.length; await expect(f.service.connect(owner, token)).rejects.toThrow("zotero_unavailable"); expect(f.provider.calls).toHaveLength(count);
  });
  it("writes 50 references and their child notes in valid bounded batches, then deduplicates the complete send", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    const references = Array.from({ length: 50 }, (_, index) => ({ ...refs()[0], identity: digest(`work-${index}`), citationKey: `citation-${index}`,
      fields: { ...refs()[0].fields, title: `Work ${index}`, url: `https://source.example/${index}`, citationKey: `citation-${index}`, extra: `Keryx identity: ${digest(`work-${index}`)}` } }));
    expect(await f.service.send(owner, collection, references)).toMatchObject({ writes: 100 });
    expect(f.provider.calls.filter(call => call.method === "POST").map(call => call.body!.length)).toEqual([50, 50]);
    for (const item of f.provider.items.values()) if (item.data.itemType === "note") expect(f.provider.items.has(String(item.data.parentItem))).toBe(true);
    expect(await f.service.send(owner, collection, references)).toMatchObject({ writes: 0 }); expect(f.provider.items.size).toBe(100);
  });
  it("preserves canonical scholarly report fields and provider name parts regardless of JSON property order", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    const citation: Citation = { marker: "S1", sourceId: "source", sourceName: "Publisher", itemId: "work", itemTitle: "Full journal metadata", itemUrl: "https://source.example/item", weight: 1, reward: 0, rationale: "synthetic", scholarly: {
      provider: "crossref", recordUrl: "https://api.crossref.org/works/10.1/example", retrievedAt: "2026-10-11T00:00:00Z", title: "Full journal metadata", authors: ["Ada Example"], authorNames: [{ given: "Ada", family: "Example" }], doi: "10.1/example", workType: "journal-article", journal: "Journal", publishedDate: "2025-02-01", volume: "3", issue: "2", pages: "7–9", peerReview: "unknown", evidenceScope: "publisher-page" } };
    const references = zoteroReportReferences({ id: "full-report", citations: [citation], evidence: [] } as unknown as QueryRun, "https://keryx.example"), fields = references[0].fields;
    expect(fields).toMatchObject({ DOI: "10.1/example", date: "2025", volume: "3", issue: "2", pages: "7–9", publicationTitle: "Journal", creators: [{ creatorType: "author", firstName: "Ada", lastName: "Example" }] });
    const bib = buildCitationExport([citation], "bibtex").content;
    for (const field of ["doi = {10.1/example}", "year = {2025}", "journal = {Journal}", "volume = {3}", "number = {2}", "pages = {7–9}"]) expect(bib).toContain(field);
    await f.service.send(owner, collection, references);
    const parent = [...f.provider.items.values()].find(row => row.data.itemType === "journalArticle")!;
    parent.data.creators = [{ lastName: "Example", firstName: "Ada", creatorType: "author" }];
    expect(await f.service.send(owner, collection, references)).toMatchObject({ writes: 0 });
  });
  it.each([429, 503])("persists Retry-After from %i and sends no follow-up request", async status => {
    const f = fixture(); await f.service.connect(owner, token);
    const transport = vi.fn<typeof fetch>(async () => new Response(token, { status, headers: { "Retry-After": "120" } }));
    await expect(createZoteroService(f.store, transport).send(owner, collection, refs())).rejects.toThrow("zotero_backoff");
    await expect(f.service.collections(owner)).rejects.toThrow("zotero_backoff"); expect(transport).toHaveBeenCalledOnce();
  });
  it.each(["owner", "user"])("refuses encrypted-token copies with mismatched %s AAD before sending a credential", async mismatch => {
    const f = fixture(); await f.service.connect(owner, token); const other = `0x${"b".repeat(40)}`, lease = await f.store.acquire(other, false);
    const encrypted = encryptContent(token, new TextEncoder().encode(`keryx-zotero-token-v1:${mismatch === "owner" ? owner : other}:${mismatch === "user" ? "9998" : "9999"}`));
    await f.store.connect(lease, "9999", encrypted); await f.store.release(lease); const count = f.provider.calls.length;
    await expect(f.service.collections(other)).rejects.toThrow("zotero_unavailable"); expect(f.provider.calls).toHaveLength(count);
  });
});

describe("session-bound reference API", () => {
  function request(method: string, body?: unknown, extra: Record<string, string> = {}) {
    return new Request("https://keryx.example/api/me/references/zotero", { method, headers: { Origin: "https://keryx.example", "X-Keryx-Expected-Wallet": owner, "Content-Type": "application/json", ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  function routes() {
    const f = fixture(), context = { wallet: owner, db: { zotero: f.store } as KeryxDB }, session = vi.fn(async () => context);
    return { ...f, context, session, routes: createZoteroRoutes(session, "https://keryx.example", "eip155:5042002", () => true, f.provider.transport) };
  }
  it("rejects API keys, cross-origin writes, missing owner headers and changed owners before provider I/O", async () => {
    const f = routes();
    expect((await f.routes.connect(request("PUT", { apiKey: token }, { Authorization: "Bearer historical" }))).status).toBe(401);
    expect((await f.routes.connect(request("PUT", { apiKey: token }, { Origin: "https://other.example" }))).status).toBe(403);
    const absent = request("GET"); absent.headers.delete("X-Keryx-Expected-Wallet"); expect((await f.routes.status(absent)).status).toBe(428);
    expect((await f.routes.status(request("GET", undefined, { "X-Keryx-Expected-Wallet": `0x${"b".repeat(40)}` }))).status).toBe(409);
    expect(f.provider.calls).toEqual([]);
  });
  it("returns only private safe machine contracts and rejects unknown/oversized secret inputs", async () => {
    const f = routes(), response = await f.routes.connect(request("PUT", { apiKey: token })); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ connected: true, userId: "1234" });
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await f.routes.send(request("POST", { kind: "papers", collection, papers: [PAPER_CATALOG[0]], excerpt: "FORGED" }))).status).toBe(400);
    const tooBig = new Request("https://keryx.example/api/me/references/zotero", { method: "PUT", headers: { Origin: "https://keryx.example", "X-Keryx-Expected-Wallet": owner, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: token, padding: "x".repeat(262_144) }) });
    expect((await f.routes.connect(tooBig)).status).toBe(400);
    const unsupported = createZoteroRoutes(async () => ({ wallet: owner, db: {} as KeryxDB }), "https://keryx.example", "eip155:5042002", () => true, f.provider.transport);
    expect((await unsupported.connect(request("PUT", { apiKey: token }))).status).toBe(503);
  });
  it("uses the live owner reader and withholds private or foreign reports before provider I/O", async () => {
    const f = routes(); await f.service.connect(owner, token); const read = vi.fn(async () => null);
    Object.assign(f.context.db, { runOwnershipHistory: { read } }); const before = f.provider.calls.length;
    const body = { kind: "report", collection, reportId: "foreign-report" };
    expect((await f.routes.send(request("POST", body))).status).toBe(404); expect(read).toHaveBeenCalledWith(owner, { network: "eip155:5042002", origin: "https://keryx.example" }, "foreign-report");
    read.mockResolvedValueOnce({ run: { id: "prv_private", originalFulfillment: {} } } as never);
    expect((await f.routes.send(request("POST", body))).status).toBe(404); expect(f.provider.calls).toHaveLength(before);
  });
  it("keeps upstream exception text and rejected permissions out of API responses", async () => {
    const f = routes(); f.provider.state.groups = { all: { write: true } };
    const response = await f.routes.connect(request("PUT", { apiKey: token })); expect(response.status).toBe(403);
    expect(await response.text()).toBe('{"error":"zotero_scopes"}');
  });
  it("returns a fixed private conflict without disclosing the wallet already bound to the library", async () => {
    const f = routes(); await f.service.connect(`0x${"b".repeat(40)}`, token);
    const response = await f.routes.connect(request("PUT", { apiKey: token }));
    expect(response.status).toBe(409); expect(await response.text()).toBe('{"error":"zotero_library_bound"}');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await f.store.status(owner)).toEqual({ connected: false, userId: null });
  });
});
