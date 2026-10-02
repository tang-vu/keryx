/** Public draft context only. Never carries auth, payout authority or an automatic submit. */
export interface RegistrationDraft {
  rssUrl?: string; url?: string; name?: string; description?: string;
  gapId?: string; matchedItemLink?: string; owner?: string;
}
const MAX_CONNECT_HREF = 6_000;
const MAX_TARGET = MAX_CONNECT_HREF;
const RESERVED_OWNER = "0x" + "0".repeat(40);
function webUrl(value: string | null): string | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    const normalized = url.toString();
    return normalized.length <= 2048 ? normalized : undefined;
  } catch { return undefined; }
}
export function registrationDraft(params: URLSearchParams): RegistrationDraft {
  const rssUrl = webUrl(params.get('rss')), url = webUrl(params.get('url'));
  const name = params.get('name')?.trim() || undefined;
  const description = params.get('desc')?.trim() || undefined;
  const gap = params.get('gap')?.trim();
  const post = webUrl(params.get('post'));
  const owner = params.get('owner');
  if ((params.get('rss') && !rssUrl) || (params.get('url') && !url) || (params.get('post') && !post)) {
    throw new Error('Use full HTTP(S) draft URLs without credentials, at most 2048 normalized characters each.');
  }
  return {
    ...(rssUrl ? { rssUrl } : {}), ...(url ? { url } : {}),
    ...(name ? { name } : {}), ...(description ? { description } : {}),
    ...(rssUrl && gap && /^[a-zA-Z0-9_-]{1,128}$/.test(gap) && post ? { gapId: gap, matchedItemLink: post } : {}),
    ...(owner && /^0x[0-9a-fA-F]{40}$/.test(owner) ? { owner: owner.toLowerCase() } : {}),
  };
}
export function registrationTarget(draft: RegistrationDraft): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ rss: draft.rssUrl, url: draft.url, name: draft.name, desc: draft.description, gap: draft.gapId, post: draft.matchedItemLink, owner: draft.owner })) {
    if (value) params.set(key, value);
  }
  return `/register${params.size ? `?${params}` : ''}`;
}
/** Bound the actual nested URL, including a wallet binding added after connecting.
 * Escaped multibyte fields are retained intact or explicitly refused, never truncated. */
export function registrationConnectHref(draft: RegistrationDraft): string | null {
  const reserved = `/connect?returnTo=${encodeURIComponent(registrationTarget({ ...draft, owner: draft.owner ?? RESERVED_OWNER }))}`;
  if (reserved.length > MAX_CONNECT_HREF) return null;
  return `/connect?returnTo=${encodeURIComponent(registrationTarget(draft))}`;
}
/** Intentionally allow only the initiating browser registration surface. */
export function safeRegistrationReturn(value: string | null): string | null {
  if (!value || value.length > MAX_TARGET || !/^\/register(?:\?|$)/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://return.invalid');
    if (url.origin !== 'https://return.invalid' || url.pathname !== '/register' || url.hash) return null;
    const draft = registrationDraft(url.searchParams);
    return registrationConnectHref(draft) ? registrationTarget(draft) : null;
  } catch { return null; }
}
export function registrationOwnerMatches(target: string, address: string): boolean {
  const owner = registrationDraft(new URL(target, 'https://return.invalid').searchParams).owner;
  return !owner || owner === address.toLowerCase();
}
