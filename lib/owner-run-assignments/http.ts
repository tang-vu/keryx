import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { isConfiguredSameOrigin } from "../auth-origin";
import { AssignmentError, recipientActionSchema, recipientSchema, type Receipt } from "./contracts";

type Context = { db: KeryxDB; wallet: string; currentId: string };
type Session = () => Promise<Context | Response>;
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff" };
const json = (error: string, status: number) => Response.json({ error }, { status, headers });
const bodySchema = z.object({ expected: recipientSchema, input: recipientActionSchema }).strict();

/** Fixed 16KiB body and five-second stream deadline. No req.json allocation. */
export async function readAssignmentBody(req: Request): Promise<unknown> {
  if (!req.body || !/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type") ?? "")) throw new Error("JSON required");
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    reject(new Error("Body deadline")); void reader.cancel().catch(() => undefined);
  }, 5000); });
  try {
    for (;;) { const item = await Promise.race([reader.read(), deadline]); if (item.done) break;
      size += item.value.length; if (size > 16_384) throw new Error("Body limit"); chunks.push(item.value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export function createAssignmentRoutes(session: Session, configuredBaseUrl: string) {
  const configuredOrigin = new URL(configuredBaseUrl).origin;
  async function execute(req: Request, mutation: boolean): Promise<Response> {
    try {
      if (new URL(req.url).search) return json("invalid_assignment_request", 400);
      if (req.headers.has("authorization")) return json("assignment_unauthenticated", 401);
      if ((mutation || req.headers.has("origin")) && !isConfiguredSameOrigin(req, configuredBaseUrl)
        || req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin") return json("same_origin_required", 403);
      const wallet = req.headers.get("x-keryx-expected-wallet");
      if (!wallet) return json("assignment_precondition_required", 428);
      if (!/^0x[a-f0-9]{40}$/.test(wallet)) return json("invalid_assignment_request", 400);
      const first = await session(); if (first instanceof Response) return json("assignment_unauthenticated", first.status);
      if (first.wallet !== wallet) return json("assignment_conflict", 409);
      const row = await first.db.getWebSession(first.currentId);
      if (!row || row.hash !== first.currentId || row.wallet !== wallet) return json("assignment_unauthenticated", 401);
      const captured = { sessionHash: row.hash, wallet: row.wallet, issuedAt: row.issuedAt, expiresAt: row.expiresAt };
      const port = first.db.ownerRunAssignments;
      if (!port) return json("assignment_unavailable", 503);
      let parsed: z.infer<typeof bodySchema> | undefined;
      if (mutation) {
        try { parsed = bodySchema.parse(await readAssignmentBody(req)); }
        catch { return json("invalid_assignment_request", 400); }
      }
      const before = await session();
      if (before instanceof Response || before.db !== first.db || before.wallet !== wallet || before.currentId !== first.currentId)
        return json("assignment_unauthenticated", 401);
      let receipt: Receipt | undefined;
      if (parsed) receipt = port.act(captured, parsed.expected, parsed.input, configuredOrigin);
      const last = await session();
      if (last instanceof Response || last.db !== first.db || last.wallet !== wallet || last.currentId !== first.currentId)
        return json(receipt ? "assignment_outcome_unresolved" : "assignment_unauthenticated", receipt ? 503 : 401);
      // LAST await above. This synchronous genuine native reply rechecks the exact
      // durable account/member/credential/session and each current association.
      return port.reply(captured, wallet, configuredOrigin, parsed?.expected, receipt);
    } catch (error) {
      if (error instanceof AssignmentError) return json(error.code, error.code === "assignment_unauthenticated" ? 401
        : error.code === "assignment_conflict" ? 409 : error.code === "assignment_consent_required" || error.code === "assignment_ineligible" ? 422 : 503);
      return json("assignment_unavailable", 503);
    }
  }
  return { GET: (req: Request) => execute(req, false), POST: (req: Request) => execute(req, true) };
}
