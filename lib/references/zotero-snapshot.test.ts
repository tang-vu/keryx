import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqliteZotero, ZOTERO_SQL } from "../db/zotero-sqlite";
import { PAPER_CATALOG } from "../papers/catalog";
import { createZoteroService } from "./zotero-service";
import { digest, zoteroPaperReferences } from "./zotero-export";
import { ZoteroProvider, type ZoteroItem } from "./zotero-provider";
import { zoteroDataEqual } from "./zotero-data";

const owner = `0x${"a".repeat(40)}`, token = "SYNTHETICKEY000000000001", collection = "ABCD2345";
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/** No account/network access. Model the documented library precondition, PATCH
 * semantics, versioned replies and an independent writer rather than echo-only writes. */
function fixture() {
  vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  const db = new DatabaseSync(":memory:"); databases.push(db); installSqliteApplicationSchema(db); db.exec(ZOTERO_SQL);
  const store = createSqliteZotero(db), items = new Map<string, ZoteroItem>();
  const calls: Array<{ method: string; path: string; guard: string | null; body?: Record<string, unknown>[] }> = [];
  const controls = { version: 1, beforeWrite: () => {}, afterWrite: () => {}, reply: (value: Record<string, unknown>) => value,
    scan: (rows: ZoteroItem[]) => rows, scanVersion: (): string => String(controls.version), replyVersion: (): string => String(controls.version) };
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET", headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown>[] : undefined;
    expect(url.origin).toBe("https://api.zotero.org"); expect(headers.get("Zotero-API-Key")).toBe(token);
    expect(url.searchParams.has("key")).toBe(false); expect(init?.redirect).toBe("error"); expect(init?.credentials).toBe("omit");
    calls.push({ method, path: url.pathname, guard: headers.get("If-Unmodified-Since-Version"), body });
    const versionHeaders = () => ({ "Last-Modified-Version": String(controls.version) });
    if (url.pathname === "/keys/current") return Response.json({ userID: 1234, access: { user: { library: true, notes: true, write: true, files: false }, groups: {} } });
    if (url.pathname === "/users/1234/collections") return Response.json([{ key: collection, data: { name: "Synthetic collection" } }], { headers: { ...versionHeaders(), "Total-Results": "1" } });
    if (url.pathname === "/users/1234/items" && method === "GET") {
      const rows = controls.scan([...items.values()]);
      return Response.json(rows.slice(Number(url.searchParams.get("start")), Number(url.searchParams.get("start")) + 100),
        { headers: { "Last-Modified-Version": controls.scanVersion(), "Total-Results": String(rows.length) } });
    }
    if (url.pathname.startsWith("/users/1234/items/") && method === "GET") {
      const item = items.get(url.pathname.split("/").at(-1)!);
      return item ? Response.json(item, { headers: { "Last-Modified-Version": String(item.version) } }) : new Response(null, { status: 404 });
    }
    if (url.pathname === "/users/1234/items" && method === "POST") {
      controls.beforeWrite();
      if (headers.has("If-Unmodified-Since-Version") && headers.get("If-Unmodified-Since-Version") !== String(controls.version)) return new Response(null, { status: 412 });
      const successful: Record<string, ZoteroItem> = {}, failed: Record<string, unknown> = {};
      const next = controls.version + 1;
      for (const [index, fields] of body!.entries()) {
        const key = String(fields.key), previous = items.get(key);
        if (previous ? fields.version !== previous.version : fields.version !== 0) { failed[String(index)] = { code: 412, message: `Never disclose ${token}` }; continue; }
        const item = { key, version: next, data: { ...previous?.data, ...fields, key, version: next } as ZoteroItem["data"] };
        items.set(key, item); successful[String(index)] = item;
      }
      if (Object.keys(successful).length) controls.version = next;
      const response = Response.json(controls.reply({ successful, unchanged: {}, failed }), { headers: { "Last-Modified-Version": controls.replyVersion() } });
      controls.afterWrite(); return response;
    }
    throw new Error(`Unexpected synthetic provider request; sensitive ${token}`);
  });
  return { db, store, items, calls, controls, transport, service: createZoteroService(store, transport) };
}
function references(count = 1) {
  const base = zoteroPaperReferences([PAPER_CATALOG[0]])[0];
  return Array.from({ length: count }, (_, index) => ({ ...base, identity: digest(`snapshot-work-${index}`), citationKey: `snapshot-key-${index}`,
    fields: { ...base.fields, title: `Synthetic work ${index}`, url: `https://source.example/${index}`, DOI: `10.1234/synthetic-${index}`,
      citationKey: `snapshot-key-${index}`, extra: `Keryx identity: ${digest(`snapshot-work-${index}`)}` } }));
}
const writes = (f: ReturnType<typeof fixture>) => f.calls.filter(call => call.method === "POST");

describe("Zotero snapshot-bound writes", () => {
  it("refuses an independently added duplicate after the complete scan, before creating another item", async () => {
    const f = fixture(), refs = references(); await f.service.connect(owner, token);
    f.controls.beforeWrite = () => {
      f.controls.beforeWrite = () => {}; f.controls.version++;
      f.items.set("ZZZZ2345", { key: "ZZZZ2345", version: f.controls.version, data: { ...refs[0].fields, key: "ZZZZ2345", version: f.controls.version, collections: [collection] } as ZoteroItem["data"] });
    };
    await expect(f.service.send(owner, collection, refs)).rejects.toThrow("zotero_conflict");
    expect(writes(f).map(call => call.guard)).toEqual(["1"]); expect([...f.items.keys()]).toEqual(["ZZZZ2345"]);
    // Reserved keys are retained after uncertainty. Never silently remap them to
    // another writer's key or repeat a rejected action automatically.
    await expect(f.service.send(owner, collection, refs)).rejects.toThrow("zotero_conflict"); expect(writes(f)).toHaveLength(1);
  });
  it("advances the guard only from the accepted reply for each bounded batch and remains repeat-safe", async () => {
    const f = fixture(), refs = references(26); await f.service.connect(owner, token);
    expect(await f.service.send(owner, collection, refs)).toMatchObject({ writes: 52 });
    expect(writes(f).map(call => [call.guard, call.body!.length])).toEqual([["1", 50], ["2", 2]]);
    expect(await f.service.send(owner, collection, refs)).toMatchObject({ writes: 0 }); expect(f.items.size).toBe(52);
  });
  it("refuses a changed library between batches, then completes only the remainder on a fresh explicit action", async () => {
    const f = fixture(), refs = references(26); await f.service.connect(owner, token);
    f.controls.afterWrite = () => { f.controls.afterWrite = () => {}; f.controls.version++; };
    await expect(f.service.send(owner, collection, refs)).rejects.toThrow("zotero_conflict");
    expect(writes(f).map(call => call.guard)).toEqual(["1", "2"]); expect(f.items.size).toBe(50);
    const acceptedKeys = [...f.items.keys()];
    expect(await f.service.send(owner, collection, refs)).toMatchObject({ writes: 2 });
    expect([...f.items.keys()].slice(0, 50)).toEqual(acceptedKeys); expect(f.items.size).toBe(52);
    expect(writes(f).at(-1)?.guard).toBe("3"); expect(await f.service.send(owner, collection, refs)).toMatchObject({ writes: 0 });
  });
  it.each(["", "-1", "1.5", "9007199254740992"])("refuses invalid scan version %s before any POST", async invalid => {
    const f = fixture(); await f.service.connect(owner, token); f.controls.scanVersion = () => invalid;
    await expect(f.service.send(owner, collection, references())).rejects.toThrow("zotero_limit"); expect(writes(f)).toHaveLength(0);
  });
  it("rejects duplicate keys in a nominally complete snapshot before any POST", async () => {
    const f = fixture(), refs = references(); await f.service.connect(owner, token);
    const data = { ...refs[0].fields, key: "ZZZZ2345", version: 1 } as ZoteroItem["data"];
    f.controls.scan = () => [{ key: "ZZZZ2345", version: 1, data: { ...data, url: "https://other.example/", extra: "" } }, { key: "ZZZZ2345", version: 1, data: { ...data, url: "https://other.example/", extra: "" } }];
    await expect(f.service.send(owner, collection, refs)).rejects.toThrow("zotero_provider"); expect(writes(f)).toHaveLength(0);
  });
  it("rejects an item version newer than the declared complete snapshot before any POST", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    f.items.set("ZZZZ2345", { key: "ZZZZ2345", version: 2, data: { key: "ZZZZ2345", version: 2, itemType: "webpage", url: "https://other.example" } });
    await expect(f.service.send(owner, collection, references())).rejects.toThrow("zotero_provider"); expect(writes(f)).toHaveLength(0);
  });
});

describe("Zotero returned-field acceptance", () => {
  it.each(["", "0", "1", "-1", "1.5", "9007199254740992"])("rejects unaccepted write version %s before another batch", async invalid => {
    const f = fixture(); await f.service.connect(owner, token); f.controls.replyVersion = () => invalid;
    await expect(f.service.send(owner, collection, references(26))).rejects.toThrow("zotero_provider"); expect(writes(f)).toHaveLength(1);
    expect(f.items.size).toBe(50); // The accepted subset is never called rolled back.
  });
  it("checks canonical fields when adopting an item, while retaining unrelated provider data", async () => {
    const f = fixture(), refs = references(); await f.service.connect(owner, token);
    f.items.set("ZZZZ2345", { key: "ZZZZ2345", version: 1, data: { ...refs[0].fields, key: "ZZZZ2345", version: 1,
      citationKey: "", extra: "User metadata", collections: ["QTHER234"], tags: [{ tag: "Retain me" }], abstractNote: "Retain this abstract" } as ZoteroItem["data"] });
    f.controls.reply = value => { const copy = structuredClone(value); delete (copy.successful as Record<string, ZoteroItem>)["0"].data.title; return copy; };
    await expect(f.service.send(owner, collection, refs)).rejects.toThrow("zotero_provider");
    const parent = f.items.get("ZZZZ2345")!;
    expect(writes(f)[0].body![0]).toMatchObject({ title: refs[0].fields.title, citationKey: refs[0].citationKey, collections: ["QTHER234", collection] });
    expect(parent.data).toMatchObject({ abstractNote: "Retain this abstract", tags: [{ tag: "Retain me" }], title: refs[0].fields.title });
    expect(parent.data.extra).toContain("User metadata"); expect(writes(f)).toHaveLength(1);
  });
  it.each(["title", "url", "DOI", "citationKey", "creators", "date", "extra", "collections", "note"])("refuses a successful reply that loses the submitted %s without logging provider data", async field => {
    const f = fixture(); await f.service.connect(owner, token);
    const log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error"), warn = vi.spyOn(console, "warn");
    f.controls.reply = value => {
      const copy = structuredClone(value), entries = Object.values(copy.successful as Record<string, ZoteroItem>);
      delete entries[field === "note" ? 1 : 0].data[field]; return copy;
    };
    await expect(f.service.send(owner, collection, references())).rejects.toThrow("zotero_provider");
    expect(writes(f)).toHaveLength(1); expect(f.items.size).toBe(2); expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });
  it("refuses an internally consistent returned object whose version disagrees with the reply header", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    f.controls.reply = value => { const copy = structuredClone(value), item = (copy.successful as Record<string, ZoteroItem>)["0"]; item.version++; item.data.version++; return copy; };
    await expect(f.service.send(owner, collection, references(26))).rejects.toThrow("zotero_provider"); expect(writes(f)).toHaveLength(1);
  });
  it("accepts harmless collection order and object property order while preserving creator order", async () => {
    const f = fixture(), refs = references(); await f.service.connect(owner, token);
    f.items.set("ZZZZ2345", { key: "ZZZZ2345", version: 1, data: { ...refs[0].fields, key: "ZZZZ2345", version: 1,
      extra: "User metadata", collections: ["QTHER234"] } as ZoteroItem["data"] });
    f.controls.reply = value => {
      const copy = structuredClone(value), item = (copy.successful as Record<string, ZoteroItem>)["0"];
      item.data.collections!.reverse(); item.data = Object.fromEntries(Object.entries(item.data).reverse()) as ZoteroItem["data"]; return copy;
    };
    expect(await f.service.send(owner, collection, refs)).toMatchObject({ writes: 2 });
    expect(zoteroDataEqual([], {})).toBe(false); expect(zoteroDataEqual({}, [])).toBe(false);
    expect(zoteroDataEqual([{ name: "One" }, { name: "Two" }], [{ name: "Two" }, { name: "One" }])).toBe(false);
  });
  it("does not accept trashed objects or malformed empty arrays in successful replies", async () => {
    const f = fixture(); await f.service.connect(owner, token);
    f.controls.reply = value => { const copy = structuredClone(value); (copy.successful as Record<string, ZoteroItem>)["0"].data.deleted = 1; return copy; };
    await expect(f.service.send(owner, collection, references())).rejects.toThrow("zotero_provider");
    f.controls.reply = value => { const copy = structuredClone(value); (copy.successful as Record<string, ZoteroItem>)["0"].data.tags = {}; return copy; };
    await expect(f.service.send(owner, collection, references(2))).rejects.toThrow("zotero_provider");
    expect(writes(f)).toHaveLength(2);
  });
  it("checks unchanged objects by key against submitted fields before accepting them", async () => {
    const f = fixture(), ref = references()[0]; await f.service.connect(owner, token);
    const lease = await f.store.acquire(owner, true);
    const fields = { ...ref.fields, key: "ZZZZ2345", version: 1, collections: [collection], tags: [], relations: {} };
    f.items.set("ZZZZ2345", { key: "ZZZZ2345", version: 1, data: structuredClone(fields) as ZoteroItem["data"] });
    const transport: typeof fetch = async (input, init) => init?.method === "POST" ? Response.json({ successful: {}, unchanged: { "0": "ZZZZ2345" }, failed: {} }, { headers: { "Last-Modified-Version": "1" } }) : f.transport(input, init);
    const checked = new ZoteroProvider(token, f.store, lease, new AbortController().signal, transport);
    try {
      expect(await checked.write("1234", [fields], 1)).toBe(1);
      f.items.get("ZZZZ2345")!.data.title = "A different upstream work";
      await expect(checked.write("1234", [fields], 1)).rejects.toThrow("zotero_provider");
      expect(f.calls.filter(call => call.path.endsWith("/ZZZZ2345"))).toHaveLength(2);
    } finally { await f.store.release(lease); }
  });
  it.each(["revocation", "backoff"])("withholds unchanged-item readback after %s during the POST", async interruption => {
    const f = fixture(); await f.service.connect(owner, token); const lease = await f.store.acquire(owner, true);
    const transport = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      if (interruption === "revocation") await f.store.revoke(owner);
      return Response.json({ successful: {}, unchanged: { "0": "ZZZZ2345" }, failed: {} },
        { headers: { "Last-Modified-Version": "1", ...(interruption === "backoff" ? { Backoff: "60" } : {}) } });
    });
    const provider = new ZoteroProvider(token, f.store, lease, new AbortController().signal, transport);
    try {
      await expect(provider.write("1234", [{ ...references()[0].fields, key: "ZZZZ2345", version: 1 }], 1))
        .rejects.toThrow(interruption === "revocation" ? "zotero_disconnected" : "zotero_backoff");
      expect(transport).toHaveBeenCalledOnce();
    } finally { await f.store.release(lease); }
  });
  it.each([403, 404])("does not accept an unchanged key when its exact readback returns %i", async status => {
    const f = fixture(); await f.service.connect(owner, token); const lease = await f.store.acquire(owner, true);
    const transport = vi.fn<typeof fetch>(async (_input, init) => init?.method === "POST"
      ? Response.json({ successful: {}, unchanged: { "0": "ZZZZ2345" }, failed: {} }, { headers: { "Last-Modified-Version": "1" } })
      : new Response(`Sensitive upstream ${token}`, { status }));
    const provider = new ZoteroProvider(token, f.store, lease, new AbortController().signal, transport);
    try {
      await expect(provider.write("1234", [{ ...references()[0].fields, key: "ZZZZ2345", version: 1 }], 1))
        .rejects.toThrow(status === 403 ? "zotero_scopes" : "zotero_provider");
      expect(transport).toHaveBeenCalledTimes(2);
    } finally { await f.store.release(lease); }
  });
});
