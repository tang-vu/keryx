import { readBoundedJson } from "../read-bounded-json";
import { acceptanceInputSchema, acceptanceSnapshotSchema, deliverableIdSchema, type AcceptanceInput } from "./contracts";

/** Explicit owner-key client. No signer, cookies, redirects, retries, store/network selector or payment. */
export function createAcceptanceClient(baseUrl: string, key: () => string | undefined, fetcher: typeof fetch = fetch) {
  if (!/^https:\/\/[^/?#]+\/?$/i.test(baseUrl) || /[\s\\\u0000-\u001f\u007f]/.test(baseUrl)) throw new Error("Use the HTTPS deployment origin");
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("Use the HTTPS deployment origin");
  const request = async (id: string, input?: AcceptanceInput) => {
    const raw = key(); if (!raw || !/^kx_live_[0-9a-f]{96}$/.test(raw)) throw new Error("Configure an explicitly deliverable-scoped KERYX_API_KEY");
    const parsedId = deliverableIdSchema.parse(id), parsedInput = input === undefined ? undefined : acceptanceInputSchema.parse(input);
    const response = await fetcher(new URL(`/api/me/deliverables/${parsedId}/acceptance`, base), {
      method: parsedInput ? "POST" : "GET", headers: { Authorization: `Bearer ${raw}`, ...(parsedInput ? { "Content-Type": "application/json" } : {}) },
      body: parsedInput ? JSON.stringify(parsedInput) : undefined, credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Deliverable acceptance refused (${response.status}). Read current state before deciding whether to replay the same idempotency key.`); }
    const result = acceptanceSnapshotSchema.parse(await readBoundedJson(response, 16384));
    if (result.id !== parsedId || parsedInput && (result.originalFingerprint !== parsedInput.originalFingerprint || result.deliveredDigest !== parsedInput.deliveredDigest))
      throw new Error("Deliverable response binding mismatch");
    return result;
  };
  return { read: (id: string) => request(id), submit: (id: string, input: AcceptanceInput) => request(id, input) };
}
