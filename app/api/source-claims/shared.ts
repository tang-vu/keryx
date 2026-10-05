import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { SourceClaimError } from "@/lib/db/public-source-claims";
import { z } from "zod";

export const claimIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export function claimResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function claimError(error: unknown): Response {
  if (error instanceof SourceClaimError) return claimResponse({ error: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError) return claimResponse({ error: "Invalid source claim request", code: "invalid_request" }, 400);
  return claimResponse({ error: "Source claim state is unavailable; no earnings policy changed", code: "claims_unavailable" }, 503);
}
export async function claimWriteContext(req: Request) {
  if (req.headers.get("origin") !== new URL(config.baseUrl).origin) throw new SourceClaimError("Use the source claim page on this deployment", 403, "origin_mismatch");
  const session = await getSession();
  if (!session) throw new SourceClaimError("Sign in with the source owner wallet", 401, "unauthenticated");
  const db = await getDb();
  return { db, wallet: session.address.toLowerCase() };
}
export async function claimBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.output<T>> {
  if (Number(req.headers.get("content-length") ?? 0) > 8192) throw new SourceClaimError("Claim request is too large", 413, "request_too_large");
  const reader = req.body?.getReader();
  if (!reader) throw new SourceClaimError("JSON body required", 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new SourceClaimError("Claim request is too large", 413, "request_too_large"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value; try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new SourceClaimError("Valid JSON body required", 400, "invalid_request"); }
  return schema.parse(value) as z.output<T>;
}
