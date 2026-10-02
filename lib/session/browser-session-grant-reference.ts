import { z } from "zod";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { browserSessionCustodyContext } from "./browser-session-custody";
import type { SessionGrantConsent } from "../payments/session-grant-consent";

const reference = z.object({ sessAddr: z.string().regex(/^0x[0-9a-f]{40}$/), grantEpoch: z.string().uuid() }).strict();
function storageKey(owner: string) {
  return `${browserSessionCustodyContext(ARC_MAINNET_PROFILE, window.location.origin, owner).storageNamespace}:grant-reference`;
}
/** Public recovery selector only. It never admits payments or proves ownership; the server
 * must verify its original retained dual signatures again before funding/cashout recovery. */
export function readRetainedSessionGrantReference(owner: string, signer: string) {
  try {
    const text = localStorage.getItem(storageKey(owner));
    if (!text || text.length > 256) return null;
    const value = reference.parse(JSON.parse(text));
    return value.sessAddr === signer.toLowerCase() ? value.grantEpoch : null;
  } catch { return null; }
}
export function retainSessionGrantReference(consent: SessionGrantConsent) {
  if (consent.network !== ARC_MAINNET_PROFILE.networkId || consent.origin !== window.location.origin)
    throw new Error("Retained session selector differs from custody");
  const key = storageKey(consent.ownerAddr), value = JSON.stringify(reference.parse({ sessAddr: consent.sessAddr, grantEpoch: consent.grantEpoch }));
  // Keep every historical public selector; a newer active epoch cannot erase withdrawal history.
  localStorage.setItem(`${key}:epoch:${consent.grantEpoch}`, value);
  localStorage.setItem(key, value);
}
