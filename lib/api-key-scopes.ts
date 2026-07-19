/**
 * What an API key is allowed to do.
 *
 * Until the earnings export existed, a key did one thing: identify a caller on the ask paths.
 * Now the same key can also read every payout the wallet ever received — so handing a key to a
 * script that only needs to ask questions hands it the accounts too. Scopes split those.
 *
 * Two rules keep this honest:
 *  - A key NEVER grants more than its wallet already has. Scopes narrow; they cannot widen.
 *    Source restriction is intersected with live ownership at read time, so a key pinned to a
 *    source the wallet later loses stops returning it.
 *  - Keys minted before scopes existed store NULL and mean "everything". Silently downgrading
 *    them would break integrations that are working today; the owner re-mints to narrow.
 */

export const API_KEY_SCOPES = ["ask", "export"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === "string" && (API_KEY_SCOPES as readonly string[]).includes(value);
}

/**
 * Scopes requested at mint time → the set to store.
 * Unknown entries are dropped. An empty or absent request means all scopes: a key that can do
 * nothing is a support ticket, not a security win.
 */
export function normalizeScopes(requested: unknown): ApiKeyScope[] {
  if (!Array.isArray(requested)) return [...API_KEY_SCOPES];
  const kept = API_KEY_SCOPES.filter((s) => requested.includes(s));
  return kept.length > 0 ? kept : [...API_KEY_SCOPES];
}

/** Stored column → scopes. NULL/blank = a pre-scopes key = every scope. */
export function parseScopes(stored: string | null | undefined): ApiKeyScope[] {
  if (!stored) return [...API_KEY_SCOPES];
  const parts = stored.split(",").map((s) => s.trim()).filter(isApiKeyScope);
  return parts.length > 0 ? parts : [...API_KEY_SCOPES];
}

export function serializeScopes(scopes: ApiKeyScope[]): string {
  return scopes.join(",");
}

export function hasScope(scopes: ApiKeyScope[] | undefined, scope: ApiKeyScope): boolean {
  // Undefined means the caller authenticated by session, not by key — sessions are unscoped.
  return scopes === undefined || scopes.includes(scope);
}

/**
 * Source restriction. `null` (the default) means every source the wallet owns; a list pins the
 * key to those ids. Stored as a comma-separated column, so ids containing a comma are rejected
 * at mint time rather than silently split — source ids are slugs or 0x hashes, never commas.
 */
export function normalizeSourceIds(requested: unknown): string[] | null {
  if (!Array.isArray(requested)) return null;
  const kept = requested
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && !v.includes(","))
    .slice(0, 100);
  return kept.length > 0 ? [...new Set(kept)] : null;
}

export function parseSourceIds(stored: string | null | undefined): string[] | null {
  if (!stored) return null;
  const parts = stored.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

export function serializeSourceIds(ids: string[] | null): string | null {
  return ids && ids.length > 0 ? ids.join(",") : null;
}

/**
 * Narrow a set of owned sources to what this key may see. Ownership is decided by the caller
 * BEFORE this runs — a restriction can only ever remove sources, never add one back.
 */
export function restrictToKeySources<T extends { id: string }>(
  ownedSources: T[],
  keySourceIds: string[] | null | undefined,
): T[] {
  if (!keySourceIds || keySourceIds.length === 0) return ownedSources;
  const allowed = new Set(keySourceIds);
  return ownedSources.filter((s) => allowed.has(s.id));
}
