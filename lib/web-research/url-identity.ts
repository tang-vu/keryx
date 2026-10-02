import { createHash } from "node:crypto";
import { getDomain } from "tldts";

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const bodyIdentity = (text: string) => digest(text.normalize("NFKC").replace(/\s+/gu, " ").trim());
/** Registrable domain is a grouping proxy, not proof of ownership or independence. */
export function publisherGroup(raw: string): string {
  try { const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, ""); return getDomain(host, { allowPrivateDomains: true }) ?? host; } catch { return ""; }
}
export function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(name)) url.searchParams.delete(name);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}
