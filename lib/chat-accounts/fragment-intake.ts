/** Fixed browser code only. No request data or credential is interpolated into HTML.
 * The root beforeInteractive slot runs this before canonical hook hydration.
 * This follows run-claims/web-bootstrap's closure-local, document-local transfer;
 * it does not confer authentication or defend against privileged same-origin JS. */
export const CHAT_ACCOUNT_FRAGMENT_SLOT = "keryx-chat-account-fragment-v1";
export const chatAccountFragmentBootstrap = String.raw`(() => {
  if (location.pathname !== '/me/chat-accounts') return;
  const initial = document, slot = Symbol.for('keryx-chat-account-fragment-v1');
  let secret = location.search === '' && location.hash.length === 71
    ? /^#token=([a-f0-9]{64})$/.exec(location.hash)?.[1] ?? null : null;
  history.replaceState(history.state, '', '/me/chat-accounts');
  if (Object.prototype.hasOwnProperty.call(window, slot)) {
    secret = null;
    const previous = Reflect.get(window, slot);
    if (typeof previous === 'function') previous();
    return;
  }
  let taken = false;
  const pending = new Map();
  const changed = event => {
    const detail = event.detail;
    if (detail?.type === 'logout') {
      secret = null;
      if (typeof detail.source === 'string' && detail.source.length > 0 && detail.source.length <= 128
        && Number.isSafeInteger(detail.sequence) && detail.sequence >= 1 && typeof detail.pending === 'boolean'
        && typeof detail.confirmed === 'boolean') pending.set(detail.source, detail.pending);
    } else secret = null;
  };
  const departed = () => { secret = null; };
  addEventListener('keryx:auth', changed);
  addEventListener('pagehide', departed, { once: true });
  Object.defineProperty(window, slot, { configurable: true, value: () => {
    if (taken) return null;
    taken = true;
    removeEventListener('keryx:auth', changed);
    removeEventListener('pagehide', departed);
    const value = { token: document === initial && location.pathname === '/me/chat-accounts' ? secret : null,
      pendingLogouts: [...pending].filter(([, active]) => active).map(([source]) => source) };
    secret = null; pending.clear();
    return value;
  } });
})();`;

/** One take only, including a rejected/empty intake. No late fragment fallback:
 * a client transition without the initial bootstrap cannot accept a credential. */
export function takeChatAccountFragment(): { token: string | null; pendingLogouts: string[] } {
  const empty = { token: null, pendingLogouts: [] };
  if (typeof window === "undefined" || window.location.pathname !== "/me/chat-accounts") return empty;
  // Fail closed on unsupported late fragment/query changes as well.
  if (window.location.hash || window.location.search) {
    window.history.replaceState(window.history.state, "", "/me/chat-accounts");
    const discard: unknown = Reflect.get(window, Symbol.for(CHAT_ACCOUNT_FRAGMENT_SLOT));
    if (typeof discard === "function") discard();
    return empty;
  }
  try {
    const take: unknown = Reflect.get(window, Symbol.for(CHAT_ACCOUNT_FRAGMENT_SLOT));
    const value: unknown = typeof take === "function" ? take() : null;
    if (!value || typeof value !== "object") return empty;
    const intake = value as { token?: unknown; pendingLogouts?: unknown };
    const pendingLogouts = Array.isArray(intake.pendingLogouts)
      ? intake.pendingLogouts.filter((source): source is string => typeof source === "string" && source.length > 0 && source.length <= 128) : [];
    return { token: typeof intake.token === "string" && intake.token.length === 64 && /^[a-f0-9]{64}$/.test(intake.token) ? intake.token : null, pendingLogouts };
  } catch { return empty; }
}
