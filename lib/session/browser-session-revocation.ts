import { z } from "zod";
import { readBoundedJson } from "../read-bounded-json";

const address = z.string().regex(/^0x[0-9a-f]{40}$/);
const requestSchema = z.object({ sessionId: address, sessAddr: address, grantEpoch: z.string().uuid() }).strict();
const acknowledgement = z.union([
  z.object({ ok: z.literal(true), alreadyRevoked: z.literal(true) }).strict(),
  z.object({ ok: z.literal(true), sessAddr: address, spent: z.number().finite().nonnegative(), residualUsdc: z.number().finite().nonnegative() }).strict(),
]);

/** Captured tuple compare-and-swap: an old logout may never revoke a replacement grant.
 * The caller separately checks its local registration generation before publishing state. */
export async function revokeBrowserSessionGrant(input: { sessionId: string; sessAddr: string; grantEpoch: string },
  transport: typeof fetch = fetch) {
  const request = requestSchema.parse(structuredClone(input));
  const response = await transport("/api/session/revoke", { method: "POST", credentials: "same-origin", redirect: "error",
    headers: { "Content-Type": "application/json", accept: "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(8000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel(); throw new Error("Server revocation was not confirmed; retained custody stays locked");
  }
  const ack = acknowledgement.parse(await readBoundedJson(response, 2048));
  if ("sessAddr" in ack && ack.sessAddr !== request.sessAddr) throw new Error("Server revocation acknowledgement differs from the captured signer");
  return ack;
}
