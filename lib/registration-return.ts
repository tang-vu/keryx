/** Public draft context only. Never carries auth, payout authority or an automatic submit. */
export interface RegistrationDraft {
  rssUrl?: string; url?: string; name?: string; description?: string;
  gapId?: string; matchedItemLink?: string; owner?: string;
  sourceClaimId?: string; fetchPrice?: number;
}
export interface SourceClaimDraft { url?: string; referenceId?: string; claimId?: string; challengeId?: string; owner?: string }
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
  const sourceClaimId = params.get('sourceClaimId');
  const price = params.get('fetchPrice');
  if (sourceClaimId && !/^[a-zA-Z0-9_-]{1,128}$/.test(sourceClaimId)) throw new Error('Invalid source claim context.');
  if (price !== null && (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(price) || !Number.isSafeInteger(Math.round(Number(price) * 1_000_000)) || Math.round(Number(price) * 1_000_000) / 1_000_000 !== Number(price))) throw new Error('Use an exact, nonnegative USDC read price with at most six decimal places.');
  if ((params.get('rss') && !rssUrl) || (params.get('url') && !url) || (params.get('post') && !post)) {
    throw new Error('Use full HTTP(S) draft URLs without credentials, at most 2048 normalized characters each.');
  }
  return {
    ...(rssUrl ? { rssUrl } : {}), ...(url ? { url } : {}),
    ...(name ? { name } : {}), ...(description ? { description } : {}),
    ...(rssUrl && gap && /^[a-zA-Z0-9_-]{1,128}$/.test(gap) && post ? { gapId: gap, matchedItemLink: post } : {}),
    ...(owner && /^0x[0-9a-fA-F]{40}$/.test(owner) ? { owner: owner.toLowerCase() } : {}),
    ...(sourceClaimId ? { sourceClaimId } : {}), ...(price !== null ? { fetchPrice: Number(price) } : {}),
  };
}
export function registrationTarget(draft: RegistrationDraft): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ rss: draft.rssUrl, url: draft.url, name: draft.name, desc: draft.description, gap: draft.gapId, post: draft.matchedItemLink, owner: draft.owner, sourceClaimId: draft.sourceClaimId, fetchPrice: draft.fetchPrice })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
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
export function sourceClaimDraft(params: URLSearchParams): SourceClaimDraft {
  const url = webUrl(params.get('url'));
  if (params.get('url') && (!url || new URL(url).protocol !== 'https:')) throw new Error('Use a full, credential-free HTTPS source URL.');
  const referenceId = params.get('referenceId'), claimId = params.get('claimId'), challengeId = params.get('challengeId'), owner = params.get('owner');
  if (referenceId && !/^public:[a-z0-9-]{1,80}$/.test(referenceId)) throw new Error('Invalid public reference.');
  if (claimId && !/^[a-zA-Z0-9_-]{1,128}$/.test(claimId)) throw new Error('Invalid source claim.');
  if (challengeId && !/^[a-f0-9]{64}$/.test(challengeId)) throw new Error('Invalid source challenge.');
  return { ...(url ? { url } : {}), ...(referenceId ? { referenceId } : {}), ...(claimId ? { claimId } : {}), ...(challengeId ? { challengeId } : {}), ...(owner && /^0x[0-9a-fA-F]{40}$/.test(owner) ? { owner: owner.toLowerCase() } : {}) };
}
export function sourceClaimTarget(draft: SourceClaimDraft): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ url: draft.url, referenceId: draft.referenceId, claimId: draft.claimId, challengeId: draft.challengeId, owner: draft.owner })) if (value) params.set(key, value);
  return `/claim-source${params.size ? `?${params}` : ''}`;
}
export function sourceClaimConnectHref(draft: SourceClaimDraft): string | null {
  if (`/connect?returnTo=${encodeURIComponent(sourceClaimTarget({ ...draft, owner: draft.owner ?? RESERVED_OWNER }))}`.length > MAX_CONNECT_HREF) return null;
  return `/connect?returnTo=${encodeURIComponent(sourceClaimTarget(draft))}`;
}
export function sourceReturnWithOwner(target: string, address?: string): string {
  const url = new URL(target, 'https://return.invalid');
  if (url.pathname === '/claim-source') {
    const draft = sourceClaimDraft(url.searchParams);
    return sourceClaimTarget({ ...draft, ...(address && !draft.owner ? { owner: address.toLowerCase() } : {}) });
  }
  const draft = registrationDraft(url.searchParams);
  return registrationTarget({ ...draft, ...(address && !draft.owner ? { owner: address.toLowerCase() } : {}) });
}
/** Only the two fixed initiating creator surfaces can survive sign-in. */
export function safeRegistrationReturn(value: string | null): string | null {
  if (!value || value.length > MAX_TARGET || !/^\/(?:register|claim-source)(?:\?|$)/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://return.invalid');
    if (url.origin !== 'https://return.invalid' || !['/register', '/claim-source'].includes(url.pathname) || url.hash) return null;
    if (url.pathname === '/claim-source') { const draft = sourceClaimDraft(url.searchParams); return sourceClaimConnectHref(draft) ? sourceClaimTarget(draft) : null; }
    const draft = registrationDraft(url.searchParams);
    return registrationConnectHref(draft) ? registrationTarget(draft) : null;
  } catch { return null; }
}
export function registrationOwnerMatches(target: string, address: string): boolean {
  const url = new URL(target, 'https://return.invalid');
  const owner = (url.pathname === '/claim-source' ? sourceClaimDraft(url.searchParams) : registrationDraft(url.searchParams)).owner;
  return !owner || owner === address.toLowerCase();
}
