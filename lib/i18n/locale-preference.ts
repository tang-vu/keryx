import { negotiateUiLocale, preparedLocales, type UiLocale } from "./locales";

export const LOCALE_VALUE_PREFIX = "keryx-ui-locale-v1:";
export const LOCALE_BODY_BYTES = 64;
export type LocaleScope = { origin: string; network: string; owner: string | null };

export function canonicalLocaleOwner(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value) ? value.toLowerCase() : null;
}

/** Exact scalar grammar: aliases, JSON, whitespace and new versions are corruption. */
export function decodeLocaleValue(value: unknown): UiLocale | null {
  if (typeof value !== "string" || value.length > 32) return null;
  return preparedLocales.find(locale => value === `${LOCALE_VALUE_PREFIX}${locale}`) ?? null;
}
export function encodeLocaleValue(locale: UiLocale): string {
  if (!preparedLocales.includes(locale)) throw new Error("Unsupported interface locale");
  return `${LOCALE_VALUE_PREFIX}${locale}`;
}

/** Snapshot own enumerable data only; never invoke accessors in imported preferences. */
export function parseLocaleBody(value: unknown): UiLocale | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const entries = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).length !== 2 || Object.keys(entries).sort().join(",") !== "locale,version" ||
      Object.values(entries).some(entry => !entry.enumerable || !("value" in entry)) || entries.version.value !== 1) return null;
    const locale = entries.locale.value;
    return preparedLocales.includes(locale) ? locale : null;
  } catch { return null; }
}

export function localeScopeKey(scope: LocaleScope): string {
  const { origin, network, owner } = scope;
  if (origin.length > 256 || !/^https?:\/\/[^/?#]+$/iu.test(origin) || new URL(origin).origin !== origin ||
    !["eip155:5042", "eip155:5042002"].includes(network) || owner !== null && canonicalLocaleOwner(owner) !== owner)
    throw new Error("Invalid interface preference scope");
  return `keryx:ui-locale:v1:${network}:${origin}:${owner ?? "guest"}`;
}

type BrowserStore = Pick<Storage, "getItem" | "setItem">;
export function readBrowserLocale(storage: () => BrowserStore, scope: LocaleScope): UiLocale | null {
  try { return decodeLocaleValue(storage().getItem(localeScopeKey(scope))); } catch { return null; }
}
export function writeBrowserLocale(storage: () => BrowserStore, scope: LocaleScope, locale: UiLocale): boolean {
  try {
    const store = storage(), key = localeScopeKey(scope), value = encodeLocaleValue(locale);
    store.setItem(key, value);
    return store.getItem(key) === value;
  } catch { return false; }
}

export function selectPreference(input: { explicit?: unknown; account?: unknown; browser?: unknown; acceptLanguage?: string | null },
  enabled: readonly UiLocale[]) {
  // Invalid/disabled account values do not suppress a valid browser preference.
  const stored = negotiateUiLocale({ explicit: input.account, stored: input.browser }, enabled);
  return negotiateUiLocale({ explicit: input.explicit,
    stored: stored.source === "default" ? undefined : stored.locale, acceptLanguage: input.acceptLanguage }, enabled);
}

/** Used for account refresh/logout and catalogue reads; invalidation precedes asynchronous work. */
export function createLocaleEpoch() {
  let revision = 0;
  return { invalidate: () => ++revision, capture: () => revision, current: (ticket: number) => ticket === revision };
}

export function parseLocaleReply(value: unknown, scope: LocaleScope): { locale: UiLocale | null; acceptLanguage: string | null } | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).length !== 6 || Object.keys(fields).sort().join(",") !== "acceptLanguage,locale,network,origin,owner,version" ||
      Object.values(fields).some(field => !field.enumerable || !("value" in field)) || fields.version.value !== 1 ||
      fields.owner.value !== scope.owner || fields.network.value !== scope.network || fields.origin.value !== scope.origin) return null;
    const locale = fields.locale.value, header = fields.acceptLanguage.value;
    if (locale !== null && !preparedLocales.includes(locale) || header !== null && (typeof header !== "string" || header.length > 4096)) return null;
    return { locale, acceptLanguage: header };
  } catch { return null; }
}

/** Bounded response reading; neither malformed transport nor oversized JSON becomes a preference. */
export async function readLocaleJson(response: Response, maximum = 8192): Promise<unknown> {
  if (!response.body) throw new Error("Locale response unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > maximum) throw new Error("Locale response too large");
      chunks.push(part.value);
    }
    const text = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { text.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(text));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
