import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqlitePrivateBibliographies } from "../db/private-bibliographies-sqlite";
import type { KeryxDB } from "../db/keryx-db";
import { PAPER_CATALOG } from "../papers/catalog";
import { paperReferencesBibtex } from "../papers/reference-export";
import { createBibliographyDownload, createBibliographyManagement } from "./bibliography-routes";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, input = { title: "Private owner title", papers: [PAPER_CATALOG[0]] };
const ownerHeaders = { Origin: "https://keryx.cc", "X-Keryx-Expected-Wallet": alice };
const request = (method = "GET", body?: unknown, headers: Record<string, string> = ownerHeaders) => new Request("https://keryx.cc/api/me/bibliographies", { method,
  headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const connections: DatabaseSync[] = [];
afterEach(() => { connections.splice(0).forEach(db => db.close()); });
function fixture() {
  const sqlite = new DatabaseSync(":memory:"); connections.push(sqlite); installSqliteApplicationSchema(sqlite);
  const store = createSqlitePrivateBibliographies(sqlite), db = { privateBibliographies: store } as KeryxDB;
  const session = vi.fn(async (): Promise<{ db: KeryxDB; wallet: string } | Response> => ({ db, wallet: alice }));
  return { sqlite, store, db, session, routes: createBibliographyManagement(session), download: createBibliographyDownload(async () => db) };
}
describe("explicit private bibliography API", () => {
  it("anonymous, bearer, cross-origin and missing/stale owner requests never create a snapshot", async () => {
    const f = fixture(); f.session.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    expect((await f.routes.create(request("POST", input))).status).toBe(401);
    for (const headers of [{ ...ownerHeaders, Authorization: "Bearer invalid" }, { ...ownerHeaders, Origin: "https://evil.org" }, { ...ownerHeaders, Origin: "http://keryx.cc" }, { "X-Keryx-Expected-Wallet": alice }]) {
      f.session.mockClear(); expect([401, 403]).toContain((await f.routes.create(request("POST", input, headers))).status); expect(f.session).not.toHaveBeenCalled();
    }
    expect((await f.routes.create(request("POST", input, { Origin: ownerHeaders.Origin }))).status).toBe(428);
    expect((await f.routes.list(request("GET", undefined, { ...ownerHeaders, "X-Keryx-Expected-Wallet": "invalid" }))).status).toBe(400);
    f.session.mockResolvedValue({ db: f.db, wallet: bob });
    expect((await f.routes.create(request("POST", input))).status).toBe(409);
    expect((await f.routes.list(request())).status).toBe(409); expect(await f.store.list(alice)).toEqual([]); expect(await f.store.list(bob)).toEqual([]);
  });
  it("create, replace, download and revoke agree on exact formatter bytes and stable URL", async () => {
    const f = fixture(), response = await f.routes.create(request("POST", input)); expect(response.status).toBe(201);
    const created = await response.json(), filename = created.urlPath.split("/").at(-1);
    const get = () => f.download(new Request("https://keryx.cc" + created.urlPath), filename);
    const download = await get(); expect(download.status).toBe(200); expect(await download.text()).toBe(paperReferencesBibtex(input.papers).content);
    expect(download.headers.get("cache-control")).toBe("private, no-store"); expect(download.headers.get("referrer-policy")).toBe("no-referrer");
    expect(download.headers.get("x-robots-tag")).toContain("noindex"); expect(download.headers.get("content-disposition")).toContain("references.bib");
    const listing = await (await f.routes.list(request())).json(); expect(listing).toEqual({ bibliographies: [created.bibliography] }); expect(JSON.stringify(listing)).not.toContain(filename);
    expect((await f.routes.replace(request("PUT", input), created.bibliography.id)).status).toBe(428);
    const replaced = await f.routes.replace(request("PUT", { ...input, papers: [] }, { ...ownerHeaders, "If-Match": '"1"' }), created.bibliography.id);
    expect(replaced.status).toBe(200); expect((await replaced.json()).bibliography.revision).toBe(2); expect(await (await get()).text()).toBe("");
    expect((await f.routes.revoke(request("DELETE", undefined, { ...ownerHeaders, "If-Match": '"1"' }), created.bibliography.id)).status).toBe(409);
    expect((await f.routes.revoke(request("DELETE", undefined, { ...ownerHeaders, "If-Match": '"2"' }), created.bibliography.id)).status).toBe(200);
    const revoked = await get(); expect(revoked.status).toBe(404); expect(await revoked.json()).toEqual({ error: "bibliography_not_found" });
  });
  it("a bearer read has no owner selector or arbitrary stored report access; malformed/revoked keys match", async () => {
    const f = fixture(), bad = "0".repeat(64) + ".bib";
    for (const filename of [bad, "../../original.json", "arbitrary-report.bib"]) expect((await f.download(new Request("https://keryx.cc/api/bibliographies/" + bad), filename)).status).toBe(404);
    expect((await f.download(new Request("https://keryx.cc/api/bibliographies/" + bad + "?wallet=" + alice), bad)).status).toBe(404);
    expect((await f.routes.list(new Request("https://keryx.cc/api/me/bibliographies?wallet=" + alice, { headers: ownerHeaders }))).status).toBe(400);
  });
  it("unsupported and sealed stores refuse without any fallback", async () => {
    const noStore = {} as KeryxDB, routes = createBibliographyManagement(async () => ({ db: noStore, wallet: alice }));
    expect((await routes.create(request("POST", input))).status).toBe(503);
    const download = createBibliographyDownload(async () => noStore); expect((await download(new Request("https://keryx.cc/api/bibliographies/file"), "0".repeat(64) + ".bib")).status).toBe(503);
    Object.defineProperty(noStore, "privateBibliographies", { get() { throw new Error("sealed authority"); } });
    expect((await routes.list(request())).status).toBe(503);
  });
  it("body validation refuses private workspace fields, controls, excess bytes and invalid UTF-8", async () => {
    const f = fixture();
    for (const invalid of [{ ...input, notes: "private" }, { ...input, title: "New\nrecord" }, { ...input, papers: [{ ...input.papers[0], screening: "include" }] }, { ...input, title: "A".repeat(262145) }, []])
      expect((await f.routes.create(request("POST", invalid))).status).toBe(400);
    expect((await f.routes.create(new Request("https://keryx.cc/api/me/bibliographies", { method: "POST", headers: { ...ownerHeaders, "Content-Type": "application/json" }, body: new Uint8Array([255]) }))).status).toBe(400);
    expect(await f.store.list(alice)).toEqual([]);
  });
  it("a stalled request body reaches its deadline even if cancellation never settles", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(), cancel = vi.fn(() => new Promise<void>(() => undefined));
      const body = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined), cancel });
      const pending = f.routes.create(new Request("https://keryx.cc/api/me/bibliographies", { method: "POST", headers: { ...ownerHeaders, "Content-Type": "application/json" }, body, duplex: "half" } as RequestInit));
      await vi.advanceTimersByTimeAsync(5001); expect((await pending).status).toBe(400); expect(cancel).toHaveBeenCalledOnce(); expect(await f.store.list(alice)).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
