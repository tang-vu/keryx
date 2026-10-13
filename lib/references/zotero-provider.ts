import { z } from "zod";
import { ZoteroError, zoteroCollectionsSchema, zoteroKeySchema, type ZoteroLease, type ZoteroStore } from "./zotero-contract";
import { zoteroSubmittedFieldsMatch } from "./zotero-data";

const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
function libraryVersion(value: string | null): number | undefined {
  if (value !== null && /^(0|[1-9]\d{0,14})$/.test(value)) return Number(value);
}
export const zoteroItemSchema = z.object({ key: zoteroKeySchema, version, data: z.object({
  key: zoteroKeySchema, version, itemType: z.string().max(64), title: z.string().max(16384).optional(),
  url: z.string().max(4096).optional(), DOI: z.string().max(1024).optional(), extra: z.string().max(131072).optional(),
  collections: zoteroKeySchema.array().max(1000).optional(), deleted: z.union([z.literal(0), z.literal(1)]).optional(),
}).passthrough() }).passthrough().refine(row => row.key === row.data.key && row.version === row.data.version);
export type ZoteroItem = z.infer<typeof zoteroItemSchema>;
let inFlight = 0;
/** HTTPS allowlist, header-only key, bounded response/deadline and zero automatic retries. */
export class ZoteroProvider {
  constructor(private token: string, private store: ZoteroStore, private lease: ZoteroLease, private signal: AbortSignal, private transport: typeof fetch = fetch) {}
  async request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<{ response: Response; value: unknown }> {
    await this.store.check(this.lease);
    if (this.signal.aborted) throw new ZoteroError("zotero_provider");
    if (inFlight >= 4) throw new ZoteroError("zotero_busy");
    if (!/^\/(?:keys\/current|users\/[1-9]\d{0,14}\/(?:items|collections)(?:\/[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8})?)(?:\?[A-Za-z0-9=&]+)?$/.test(path)) throw new ZoteroError("zotero_unavailable");
    inFlight++;
    try {
      const deadline = AbortSignal.any([this.signal, AbortSignal.timeout(15_000)]);
      const response = await this.transport(`https://api.zotero.org${path}`, { method, headers: { "Zotero-API-Key": this.token, "Zotero-API-Version": "3", ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", redirect: "error", credentials: "omit", signal: deadline });
      // Persist backoff even on success. The current response can be recorded, but
      // every subsequent request checks the shared store and is withheld.
      const waits = [response.headers.get("backoff"), response.headers.get("retry-after")].filter((entry): entry is string => entry !== null);
      const seconds = waits.map(entry => /^\d+$/.test(entry) ? Number(entry) : Math.max(0, Math.ceil((Date.parse(entry) - Date.now()) / 1000)));
      if (seconds.some(value => !Number.isSafeInteger(value) || value < 0)) {
        await this.store.backoff(this.lease, Number.MAX_SAFE_INTEGER); await response.body?.cancel(); throw new ZoteroError("zotero_backoff");
      }
      const delay = Math.max(0, ...seconds, response.status === 429 && !waits.length ? 60 : 0);
      if (delay) await this.store.backoff(this.lease, Math.min(Number.MAX_SAFE_INTEGER, Date.now() + delay * 1000));
      if (response.status === 429 || response.status === 503 && delay) { await response.body?.cancel(); throw new ZoteroError("zotero_backoff"); }
      if (response.status === 403) { await response.body?.cancel(); throw new ZoteroError("zotero_scopes"); }
      if ([409, 412].includes(response.status)) { await response.body?.cancel(); throw new ZoteroError("zotero_conflict"); }
      if (response.status === 404) { await response.body?.cancel(); return { response, value: null }; }
      if (!response.ok) { await response.body?.cancel(); throw new ZoteroError("zotero_provider"); }
      if (response.status === 204) return { response, value: null };
      const reader = response.body?.getReader();
      if (!reader) throw new ZoteroError("zotero_provider");
      const chunks: Uint8Array[] = []; let size = 0;
      let abort: (() => void) | undefined;
      const interrupted = new Promise<never>((_, reject) => { abort = () => reject(new ZoteroError("zotero_provider")); deadline.addEventListener("abort", abort, { once: true }); });
      try {
        deadline.throwIfAborted();
        for (;;) { const { value, done } = await Promise.race([reader.read(), interrupted]); if (done) break; size += value.length; if (size > 2_097_152) throw new ZoteroError("zotero_limit"); chunks.push(value); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return { response, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
      } finally { if (abort) deadline.removeEventListener("abort", abort); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    } catch (error) { throw error instanceof ZoteroError ? error : new ZoteroError("zotero_provider"); }
    finally { inFlight--; }
  }
  async permissions(expectedUser?: string) {
    const { value } = await this.request("/keys/current");
    const parsed = z.object({ userID: z.number().int().positive().max(99_999_999_999_999), access: z.object({
      user: z.object({ library: z.literal(true), notes: z.literal(true), write: z.literal(true), files: z.literal(false).optional() }).strict(),
      groups: z.record(z.unknown()).refine(groups => Object.keys(groups).length === 0),
    }).strict() }).passthrough().safeParse(value);
    if (!parsed.success || expectedUser && String(parsed.data.userID) !== expectedUser) throw new ZoteroError("zotero_scopes");
    return String(parsed.data.userID);
  }
  async list(user: string, resource: "items" | "collections") {
    const rows: unknown[] = []; let snapshotVersion: number | undefined, snapshotTotal: number | undefined;
    for (let start = 0; start <= 1000; start += 100) {
      const { response, value } = await this.request(`/users/${user}/${resource}?limit=100&start=${start}${resource === "items" ? "&includeTrashed=1" : ""}`);
      const observed = libraryVersion(response.headers.get("last-modified-version")), total = response.headers.get("total-results");
      if (observed === undefined || !total || !/^\d{1,4}$/.test(total) || Number(total) > 1000 || !Array.isArray(value) || value.length > 100) throw new ZoteroError("zotero_limit");
      if (snapshotVersion !== undefined && snapshotVersion !== observed || snapshotTotal !== undefined && snapshotTotal !== Number(total)) throw new ZoteroError("zotero_conflict");
      snapshotVersion = observed; snapshotTotal = Number(total); rows.push(...value);
      if (rows.length === Number(total)) return { rows, libraryVersion: observed };
      if (rows.length > Number(total) || value.length < 100) throw new ZoteroError("zotero_provider");
    }
    throw new ZoteroError("zotero_limit");
  }
  async collections(user: string) {
    const { rows } = await this.list(user, "collections");
    return zoteroCollectionsSchema.parse(rows.map(row => { const parsed = z.object({ key: zoteroKeySchema, data: z.object({ name: z.string().min(1).max(256) }) }).parse(row); return { key: parsed.key, name: parsed.data.name }; }));
  }
  async items(user: string) {
    const snapshot = await this.list(user, "items"), items = zoteroItemSchema.array().max(1000).parse(snapshot.rows);
    if (new Set(items.map(item => item.key)).size !== items.length || items.some(item => item.version > snapshot.libraryVersion)) throw new ZoteroError("zotero_provider");
    return { items, libraryVersion: snapshot.libraryVersion };
  }
  async write(user: string, items: Record<string, unknown>[], expectedVersion: number) {
    if (!items.length || items.length > 50) throw new ZoteroError("zotero_limit");
    if (libraryVersion(String(expectedVersion)) === undefined) throw new ZoteroError("zotero_provider");
    const { response, value } = await this.request(`/users/${user}/items`, "POST", items, { "If-Unmodified-Since-Version": String(expectedVersion) });
    const result = z.object({ successful: z.record(zoteroItemSchema), unchanged: z.record(zoteroKeySchema), failed: z.record(z.unknown()) }).strict().safeParse(value);
    if (!result.success) throw new ZoteroError("zotero_provider");
    // A 200 can contain partial failure; never echo provider messages or claim total success.
    if (Object.keys(result.data.failed).length) throw new ZoteroError("zotero_conflict");
    const indices = [...Object.keys(result.data.successful), ...Object.keys(result.data.unchanged)];
    if (indices.length !== items.length || new Set(indices).size !== items.length || indices.some(index => !/^(0|[1-9]\d?)$/.test(index) || Number(index) >= items.length)) throw new ZoteroError("zotero_provider");
    const acceptedVersion = libraryVersion(response.headers.get("last-modified-version"));
    if (acceptedVersion === undefined || acceptedVersion < expectedVersion || Object.keys(result.data.successful).length && acceptedVersion === expectedVersion) throw new ZoteroError("zotero_provider");
    for (let index = 0; index < items.length; index++) {
      const saved = result.data.successful[String(index)], unchanged = result.data.unchanged[String(index)];
      if ((saved?.key ?? unchanged) !== items[index].key) throw new ZoteroError("zotero_provider");
      if (saved) {
        if (saved.version !== acceptedVersion || saved.data.deleted === 1 || !zoteroSubmittedFieldsMatch(saved.data, items[index])) throw new ZoteroError("zotero_provider");
      } else {
        // An unchanged result supplies only a key, not field-equality evidence.
        // Read that exact object without retries; every request retains the lease,
        // backoff, byte and operation deadline checks.
        const read = await this.request(`/users/${user}/items/${unchanged}`), parsed = zoteroItemSchema.safeParse(read.value);
        if (!parsed.success || parsed.data.key !== unchanged || parsed.data.version > acceptedVersion || parsed.data.data.deleted === 1
          || libraryVersion(read.response.headers.get("last-modified-version")) !== parsed.data.version
          || !zoteroSubmittedFieldsMatch(parsed.data.data, items[index])) throw new ZoteroError("zotero_provider");
      }
    }
    return acceptedVersion;
  }
}
