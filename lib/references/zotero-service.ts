import { decryptContent, encryptContent, hasContentKey } from "../ipfs/content-crypto";
import { ZoteroError, zoteroTokenSchema, type ZoteroLease, type ZoteroStore } from "./zotero-contract";
import { digest, type ZoteroReference } from "./zotero-export";
import { ZoteroProvider, type ZoteroItem } from "./zotero-provider";
import { arxivDocumentId, normalizeVersionedArxivId } from "../scholarly/arxiv-identity";
import { zoteroDataEqual } from "./zotero-data";

const aad = (owner: string, user: string) => new TextEncoder().encode(`keryx-zotero-token-v1:${owner}:${user}`);
function matches(item: ZoteroItem, reference: ZoteroReference) {
  return Object.entries(reference.fields).every(([key, value]) => key === "extra" || key === "citationKey" || zoteroDataEqual(item.data[key] ?? (Array.isArray(value) ? [] : ""), value));
}
function arxivIdentity(data: Record<string, unknown>) {
  const extra = String(data.extra ?? "");
  return /^Archive: arXiv$/mi.test(extra) && normalizeVersionedArxivId(extra.match(/^Archive location: (.*)$/m)?.[1] ?? "") || arxivDocumentId(String(data.url ?? ""));
}
function candidate(data: Record<string, unknown>, reference: ZoteroReference) {
  const extra = String(data.extra ?? "");
  if (extra.split("\n").includes(`Keryx identity: ${reference.identity}`)) return true;
  const wantedVersion = String(reference.fields.extra).match(/^Content version: (.*)$/m)?.[1];
  const recordedVersion = extra.match(/^Content version: (.*)$/m)?.[1];
  if (recordedVersion && wantedVersion && recordedVersion !== wantedVersion) return false;
  const recordedArxiv = arxivIdentity(data), wantedArxiv = arxivIdentity(reference.fields);
  if (recordedArxiv && wantedArxiv && recordedArxiv !== wantedArxiv) return false;
  // An unrelated marker on the same landing URL cannot be silently relabeled.
  return data.url === reference.fields.url || !!reference.fields.DOI && String(data.DOI ?? "").toLowerCase() === String(reference.fields.DOI).toLowerCase();
}
/** One bounded, explicit operation. Revocation invalidates the durable lease before each request. */
export function createZoteroService(store: ZoteroStore, transport: typeof fetch = fetch) {
  async function operation<T>(owner: string, connected: boolean, signal: AbortSignal | undefined, action: (lease: ZoteroLease, provider: ZoteroProvider) => Promise<T>, suppliedToken?: string) {
    if (!hasContentKey()) throw new ZoteroError("zotero_unavailable");
    const lease = await store.acquire(owner, connected);
    try {
      let token = suppliedToken;
      if (connected) {
        const envelope = lease.encrypted;
        if (!envelope || !lease.userId) throw new ZoteroError("zotero_disconnected");
        token = decryptContent(envelope.cipherB64, envelope.wrappedKeyB64, envelope.ivB64, envelope.authTagB64, envelope.wrapIvB64, aad(lease.owner, lease.userId));
      }
      token = zoteroTokenSchema.parse(token);
      return await action(lease, new ZoteroProvider(token, store, lease, AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]), transport));
    } catch (error) { throw error instanceof ZoteroError ? error : new ZoteroError("zotero_unavailable"); }
    finally { await store.release(lease); }
  }
  return {
    status: (owner: string) => store.status(owner),
    revoke: (owner: string) => store.revoke(owner),
    connect: (owner: string, apiKey: string, signal?: AbortSignal) => operation(owner, false, signal, async (lease, provider) => {
      const user = await provider.permissions();
      await store.connect(lease, user, encryptContent(apiKey, aad(lease.owner, user)));
      return { connected: true, userId: user };
    }, apiKey),
    collections: (owner: string, signal?: AbortSignal) => operation(owner, true, signal, async (lease, provider) => {
      const user = await provider.permissions(lease.userId!); return provider.collections(user);
    }),
    send: (owner: string, collection: string, references: ZoteroReference[], signal?: AbortSignal, reportAdmission?: () => Promise<void>) => operation(owner, true, signal, async (lease, provider) => {
      await reportAdmission?.();
      if (!references.length || references.length > 50 || new Set(references.map(row => row.identity)).size !== references.length) throw new ZoteroError("zotero_limit");
      // Admit the complete canonical set before reserving keys or posting. Distinct
      // source/item identities can share a URL/version; never collapse their keys
      // or create parents that the next identical send would reject as duplicates.
      for (let index = 0; index < references.length; index++) for (const other of references.slice(index + 1)) {
        if (candidate(references[index].fields, other) || candidate(other.fields, references[index])) throw new ZoteroError("zotero_conflict");
      }
      const user = await provider.permissions(lease.userId!);
      const collections = await provider.collections(user);
      if (!collections.some(row => row.key === collection)) throw new ZoteroError("zotero_conflict");
      // Scan a complete bounded library snapshot before the first write. A large,
      // changing, duplicate or incompatible library refuses instead of guessing.
      const snapshot = await provider.items(user), remote = snapshot.items, planned: Record<string, unknown>[] = [];
      for (const reference of references) {
        const found = remote.filter(item => item.data.itemType !== "note" && item.data.itemType !== "attachment" && candidate(item.data, reference));
        if (found.length > 1 || found[0] && (!matches(found[0], reference) || found[0].data.deleted === 1)) throw new ZoteroError("zotero_conflict");
        const item = found[0], key = await store.key(lease, user, reference.identity, item?.key);
        if (!item) {
          // version 0 prevents overwriting a colliding or ambiguously accepted key.
          if (remote.some(row => row.key === key)) throw new ZoteroError("zotero_conflict");
          planned.push({ ...reference.fields, key, version: 0, collections: [collection], tags: [], relations: {} });
        } else {
          if (item.data.citationKey && item.data.citationKey !== reference.citationKey) throw new ZoteroError("zotero_conflict");
          for (const line of String(reference.fields.extra).split("\n")) {
            const label = line.slice(0, line.indexOf(":")) + ":";
            if (item.data.extra?.split("\n").some(existing => existing.startsWith(label) && existing !== line)) throw new ZoteroError("zotero_conflict");
          }
          const extra = [...new Set([...(item.data.extra?.split("\n").filter(Boolean) ?? []), ...String(reference.fields.extra).split("\n")])].join("\n");
          const membership = item.data.collections ?? [];
          if (!membership.includes(collection) || item.data.extra !== extra || !item.data.citationKey) planned.push({ ...reference.fields, key, version: item.version,
            collections: [...new Set([...membership, collection])], citationKey: reference.citationKey, extra });
        }
        const identical = remote.filter(row => row.data.itemType === "note" && row.data.parentItem === key && row.data.note === reference.note && row.data.deleted !== 1);
        if (identical.length > 1) throw new ZoteroError("zotero_conflict");
        const noteKey = await store.key(lease, user, digest(`keryx-zotero-note-v1:${key}:${reference.note}`), identical[0]?.key);
        if (!identical.length) {
          if (remote.some(row => row.key === noteKey)) throw new ZoteroError("zotero_conflict");
          planned.push({ key: noteKey, version: 0, itemType: "note", parentItem: key, note: reference.note, tags: [], collections: [], relations: {} });
        }
      }
      let libraryVersion = snapshot.libraryVersion;
      for (let start = 0; start < planned.length; start += 50) {
        // Publication can be revoked while provider reads are held. Recheck the
        // exact admitted revision/export before each new write, without retries.
        await reportAdmission?.();
        // Object versions alone cannot detect an independently created duplicate
        // after our scan. Guard the whole library and advance only on accepted
        // replies. A 412 needs a new explicit action with a fresh complete scan.
        libraryVersion = await provider.write(user, planned.slice(start, start + 50), libraryVersion);
      }
      return { references: references.length, writes: planned.length, collection, provider: "zotero" as const };
    }),
  };
}
