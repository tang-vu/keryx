import { fetchPublicDocument } from "../net/public-fetch";

export type MetadataFetch = (url: string, signal?: AbortSignal) => Promise<string>;
/** Fixed official endpoints only. Pacing is process-wide, no queue, no retries. */
const slots = new Map<string, { busy: boolean; next: number }>();
export const fetchMetadata: MetadataFetch = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !["api.crossref.org", "export.arxiv.org"].includes(parsed.hostname)
    || parsed.username || parsed.password || parsed.port) throw new Error("Invalid scholarly endpoint");
  const slot = slots.get(parsed.hostname) ?? { busy: false, next: 0 };
  slots.set(parsed.hostname, slot);
  if (slot.busy || Date.now() < slot.next) throw new Error("Scholarly provider busy or cooling down");
  slot.busy = true;
  const interval = parsed.hostname === "export.arxiv.org" ? 3000 : 1000;
  try {
    return (await fetchPublicDocument(url, { maxBytes: 250000, timeoutMs: 6000, maxHops: 0,
      httpsOnly: true, signal, allowedContentTypes: ["application/json", "application/atom+xml", "application/xml", "text/xml"] })).text;
  } catch { slot.next = Date.now() + 30000; throw new Error("Scholarly provider unavailable"); }
  finally { slot.busy = false; slot.next = Math.max(slot.next, Date.now() + interval); }
};

export function cleanText(value: unknown, max = 300): string | undefined {
  if (typeof value !== "string") return;
  return value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max) || undefined;
}
