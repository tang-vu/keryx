import { BUYER_ENDPOINT, BUYER_ORIGIN } from "./protocol";

/** Bounded metadata body with active reader cancellation; cancellation never waits on a remote body. */
export async function readAccountMetadata(response: Response, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  signal.throwIfAborted();
  if (!response.body || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 131072) throw new Error("Account metadata unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const stop = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      size += value.length; if (size > maxBytes) throw new Error("Account metadata exceeds source bound"); chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
  } finally { signal.removeEventListener("abort", stop); stop(); reader.releaseLock(); }
}

export type AccountPurchaseSession = { address: string; id: string; issuedAt: number; expiresAt: number };
declare const consentBrand: unique symbol;
export type AccountPurchaseConsent = { readonly [consentBrand]: true };
const consents = new WeakMap<object, { session: AccountPurchaseSession; current: () => boolean }>();

function browserOrigin() {
  if (typeof window === "undefined" || window.location.origin !== BUYER_ORIGIN) throw new Error("Account purchase requires the fixed browser origin");
}

// A read deadline covers body consumption too, including bodies which ignore abort.
async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  const abort = new AbortController();
  const stop = () => abort.abort();
  signal?.throwIfAborted(); signal?.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(stop, 5000);
  let response: Response | undefined;
  let rejectAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Account session read cancelled")); abort.signal.addEventListener("abort", rejectAbort, { once: true }); });
  try {
    return await Promise.race([cancelled, (async () => {
      response = await fetch(path, { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal: abort.signal });
      if (abort.signal.aborted) { void response.body?.cancel().catch(() => undefined); abort.signal.throwIfAborted(); }
      if (!response.ok) throw new Error("Current account session unavailable");
      return readAccountMetadata(response, abort.signal, 32768);
    })()]);
  } finally {
    clearTimeout(timeout); signal?.removeEventListener("abort", stop);
    abort.signal.removeEventListener("abort", rejectAbort); abort.abort();
    void response?.body?.cancel().catch(() => undefined);
  }
}

/** Existing signed-cookie endpoints verify the durable row; hashes are selectors, not credentials. */
export async function readAccountPurchaseSession(signal?: AbortSignal): Promise<AccountPurchaseSession> {
  browserOrigin();
  const current = (packet: unknown) => {
    const rows = (packet as { sessions?: unknown[] })?.sessions;
    if (!Array.isArray(rows) || rows.length > 100) throw new Error("Current account session unavailable");
    const matches = rows.filter(row => (row as { current?: unknown })?.current === true) as AccountPurchaseSession[];
    const row = matches[0];
    if (matches.length !== 1 || !row || !/^[a-f0-9]{64}$/.test(row.id) || !Number.isSafeInteger(row.issuedAt)
      || !Number.isSafeInteger(row.expiresAt) || row.issuedAt > Date.now() || row.expiresAt <= Date.now()) throw new Error("Current account session unavailable");
    return row;
  };
  const first = current(await read("/api/auth/sessions", signal));
  const packet = await read("/api/auth/session", signal) as { session?: { address?: unknown } };
  const address = packet?.session?.address;
  const last = current(await read("/api/auth/sessions", signal));
  signal?.throwIfAborted(); browserOrigin();
  if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address) || first.id !== last.id
    || first.issuedAt !== last.issuedAt || first.expiresAt !== last.expiresAt) throw new Error("Account session changed; review ownership again");
  return { address: address.toLowerCase(), id: last.id, issuedAt: last.issuedAt, expiresAt: last.expiresAt };
}

/** Call only after the separate interactive checkbox for this NEW purchase. */
export function consentToAccountPurchase(session: AccountPurchaseSession, current: () => boolean): AccountPurchaseConsent {
  browserOrigin();
  const proof = Object.freeze(Object.create(null)) as AccountPurchaseConsent;
  consents.set(proof, { session: Object.freeze({ ...session }), current });
  return proof;
}
export function invalidateAccountPurchaseConsent(proof: AccountPurchaseConsent | null) { if (proof) consents.delete(proof); }
export async function assertAccountPurchaseConsent(proof: AccountPurchaseConsent, signal?: AbortSignal) {
  const bound = consents.get(proof);
  if (!bound || !bound.current()) throw new Error("Account consent changed; review ownership again");
  const fresh = await readAccountPurchaseSession(signal);
  if (consents.get(proof) !== bound || !bound.current() || JSON.stringify(fresh) !== JSON.stringify(bound.session)) {
    invalidateAccountPurchaseConsent(proof); throw new Error("Account session changed; review ownership again");
  }
}

/** Narrow new-purchase seam. Generic buyerFetch and all recovery paths retain omission. */
export async function accountOwnedPurchaseFetch(proof: AccountPurchaseConsent, url: string, init: RequestInit): Promise<Response> {
  browserOrigin();
  const destination = new URL(url), headers = new Headers(init.headers);
  if (url !== BUYER_ENDPOINT || destination.origin !== window.location.origin || destination.username || destination.password
    || init.method !== "POST" || typeof init.body !== "string" || headers.get("content-type") !== "application/json"
    || !headers.get("payment-signature") || [...headers.keys()].sort().join(",") !== "content-type,payment-signature"
    || init.credentials !== undefined || init.redirect !== undefined) throw new Error("Invalid account purchase transport");
  await assertAccountPurchaseConsent(proof, init.signal ?? undefined);
  const bound = consents.get(proof);
  if (!bound || !bound.current()) throw new Error("Account consent changed; review ownership again");
  // Consume before dispatch: there is no ownership replay or automatic paid retry.
  consents.delete(proof); headers.set("x-keryx-account-job", "associate");
  const deadline = AbortSignal.timeout(30_000);
  const signal = init.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
  signal.throwIfAborted();
  return fetch(url, { ...init, headers, signal, credentials: "same-origin", redirect: "error", cache: "no-store" });
}
