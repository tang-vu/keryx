/** Fixed plain JavaScript, emitted verbatim and hashed as bytes. No app bundle or
 * root layout is loaded while the fragment exists. All secret state is closure-local. */
const runClaimLandingClient = String.raw`
let secret = window.location.hash.slice(1);
window.history.replaceState(null, '', '/claim-run');
const status = document.getElementById('status');
const owner = document.getElementById('owner');
const check = document.getElementById('check');
const save = document.getElementById('save');
const signin = document.getElementById('signin');
let wallet = null, busy = false, revision = 0;
const validWallet = value => typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
const enableSave = () => { save.disabled = !secret || !wallet || busy; };
const note = text => { status.textContent = text; };
const forget = () => { secret = null; save.disabled = true; };
if (!/^[a-f0-9]{64}$/.test(secret)) secret = null;
const enabled = document.body.dataset.enabled === 'true';
if (!enabled || !secret) {
  forget(); check.disabled = true; signin.disabled = true;
  note(enabled ? copy.unavailable : copy.serviceUnavailable);
} else {
  const session = async () => {
    const response = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error('Session unavailable');
    const value = (await response.json()).session;
    if (!value || !validWallet(value.address)) throw new Error('Session unavailable');
    return value.address.toLowerCase();
  };
  const refresh = async () => {
    if (busy || !secret) return;
    const attempt = ++revision; wallet = null; owner.textContent = ''; enableSave(); note(copy.checking);
    try {
      const next = await session(); if (attempt !== revision || !secret) return;
      wallet = next; owner.textContent = next || ''; note(next ? copy.ready : copy.signedOut);
    } catch { if (attempt === revision && secret) note(copy.authUnavailable); }
    enableSave();
  };
  signin.addEventListener('click', () => { window.open('/connect', '_blank', 'noopener,noreferrer'); });
  check.addEventListener('click', refresh);
  window.addEventListener('focus', refresh);
  save.addEventListener('click', async () => {
    if (busy || !secret || !wallet) return;
    const expected = wallet; busy = true; revision++; enableSave(); note(copy.saving);
    let submitted = false;
    try {
      const fresh = await session();
      if (fresh !== expected) { wallet = fresh; owner.textContent = fresh || ''; note(fresh ? copy.changed : copy.signedOut); return; }
      submitted = true;
      const response = await fetch('/api/me/run-claims', { method: 'POST', cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', 'X-Keryx-Expected-Wallet': expected }, body: JSON.stringify({ token: secret }), signal: AbortSignal.timeout(15000) });
      if (response.ok) {
        const value = await response.json();
        if (value.version !== 1 || value.wallet !== expected || value.binding?.origin !== window.location.origin || typeof value.runId !== 'string') throw new Error('Unconfirmed claim');
        note(copy.saved);
      } else note(response.status === 404 ? copy.unavailable : copy.unconfirmed);
    } catch { note(submitted ? copy.unconfirmed : copy.authUnavailable); }
    finally { if (submitted) forget(); busy = false; enableSave(); }
  });
  // Leaving destroys this delivery, including a back/forward-cache restoration.
  window.addEventListener('pagehide', () => { revision++; forget(); wallet = null; });
  window.addEventListener('pageshow', () => { if (!secret) { owner.textContent = ''; note(copy.unavailable); } });
  void refresh();
}
`;

module.exports = { runClaimLandingClient };
