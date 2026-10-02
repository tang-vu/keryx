/** Public draft context only. Never carries auth, payout authority or an automatic submit. */
export interface RegistrationDraft {
  rssUrl?: string; url?: string; name?: string; description?: string;
  gapId?: string; matchedItemLink?: string; owner?: string;
}
const MAX_TARGET = 12_000;
function webUrl(value: string | null): string | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.toString();
  } catch { return undefined; }
}
export function registrationDraft(params: URLSearchParams): RegistrationDraft {
  const rssUrl = webUrl(params.get('rss')), url = webUrl(params.get('url'));
  const name = params.get('name')?.trim().slice(0, 200) || undefined;
  const description = params.get('desc')?.trim().slice(0, 2000) || undefined;
  const gap = params.get('gap')?.trim();
  const post = webUrl(params.get('post'));
  const owner = params.get('owner');
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
/** Intentionally allow only the initiating browser registration surface. */
export function safeRegistrationReturn(value: string | null): string | null {
  if (!value || value.length > MAX_TARGET || !/^\/register(?:\?|$)/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://return.invalid');
    if (url.origin !== 'https://return.invalid' || url.pathname !== '/register' || url.hash) return null;
    return registrationTarget(registrationDraft(url.searchParams));
  } catch { return null; }
}
export function registrationOwnerMatches(target: string, address: string): boolean {
  const owner = registrationDraft(new URL(target, 'https://return.invalid').searchParams).owner;
  return !owner || owner === address.toLowerCase();
}
