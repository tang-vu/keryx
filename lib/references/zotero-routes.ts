import type { KeryxDB } from "../db/keryx-db";
import { isConfiguredSameOrigin } from "../auth-origin";
import { ZoteroError, zoteroConnectSchema, zoteroOwner, zoteroSendSchema } from "./zotero-contract";
import { zoteroPaperReferences, zoteroReportReferences } from "./zotero-export";
import { createZoteroService } from "./zotero-service";
import type { QueryRun } from "../types";

// Read-only subset of the incoming #266 port. No privacy schema, adapter or
// activation is installed here; the owning producer supplies that capability.
type PublicationStage = { readonly runPrivacyActive?: boolean; readonly runPrivacy?: {
  read(id: string): Promise<{ exists: boolean; item: { run: QueryRun; state: { visibility: "private" | "unlisted" | "public"; revision: number; erased: boolean } } | null }>;
} };

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
type Session = () => Promise<{ db: KeryxDB; wallet: string } | Response>;
async function input(req: Request) {
  if (!req.body || !/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type") ?? "")) throw new Error("Invalid input");
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error("Body deadline")); void reader.cancel().catch(() => undefined); }, 5000); });
  try {
    for (;;) { const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break; size += value.length; if (size > 262_144) throw new Error("Body limit"); chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
/** Session-only, owner-bound actions. No research/API-key/MCP authority expansion. */
export function createZoteroRoutes(session: Session, baseUrl: string, network: string, enabled: () => boolean, transport: typeof fetch = fetch) {
  async function execute(req: Request, action: "status" | "connect" | "revoke" | "collections" | "send") {
    try {
      if (new URL(req.url).search) return json({ error: "invalid_zotero_request" }, 400);
      if (req.headers.has("authorization")) return json({ error: "session_required" }, 401);
      const owner = req.headers.get("x-keryx-expected-wallet");
      if (owner === null) return json({ error: "owner_precondition_required" }, 428);
      if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return json({ error: "invalid_owner_precondition" }, 400);
      // Collection retrieval contacts the provider and is also an explicit POST.
      if (action !== "status" && !isConfiguredSameOrigin(req, baseUrl)) return json({ error: "same_origin_required" }, 403);
      const context = await session();
      if (context instanceof Response) return new Response(context.body, { status: context.status, headers: { ...Object.fromEntries(context.headers), ...headers } });
      if (zoteroOwner(context.wallet) !== owner.toLowerCase()) return json({ error: "zotero_owner_changed" }, 409);
      if (!enabled() || !context.db.zotero) throw new ZoteroError("zotero_unavailable");
      const service = createZoteroService(context.db.zotero, transport);
      if (action === "status") return json(await service.status(context.wallet));
      if (action === "revoke") { await service.revoke(context.wallet); return json({ revoked: true }); }
      if (action === "collections") return json({ collections: await service.collections(context.wallet, req.signal) });
      let raw;
      try { raw = await input(req); } catch { return json({ error: "invalid_zotero_request" }, 400); }
      if (action === "connect") {
        const parsed = zoteroConnectSchema.safeParse(raw); if (!parsed.success) return json({ error: "invalid_zotero_request" }, 400);
        return json(await service.connect(context.wallet, parsed.data.apiKey, req.signal));
      }
      const parsed = zoteroSendSchema.safeParse(raw); if (!parsed.success) return json({ error: "invalid_zotero_request" }, 400);
      const value = parsed.data;
      let references;
      let reportAdmission: (() => Promise<void>) | undefined;
      if (value.kind === "papers") references = zoteroPaperReferences(value.papers);
      else {
        // The established owner reader verifies recorded/claimed ownership. There
        // is no public archive fallback or client-supplied URL/excerpt authority.
        const history = context.db.runOwnershipHistory;
        if (!history || network !== "eip155:5042" && network !== "eip155:5042002") throw new ZoteroError("zotero_unavailable");
        const record = await history.read(context.wallet, { network, origin: new URL(baseUrl).origin }, value.reportId);
        if (!record || record.run.originalFulfillment || record.run.id.startsWith("prv_")) throw new ZoteroError("zotero_report_not_found");
        references = zoteroReportReferences(record.run, baseUrl);
        const stage = context.db as KeryxDB & PublicationStage;
        // Match #266's captured-stage semantics. Explicit OFF keeps the admitted
        // legacy owner reader, even when a future environment flag has changed.
        const active = stage.runPrivacyActive ?? (!!stage.runPrivacy || process.env.KERYX_RUN_PRIVACY_ENABLED === "true");
        if (active) {
          if (!stage.runPrivacy || typeof stage.runPrivacy.read !== "function") throw new ZoteroError("zotero_unavailable");
          const expected = JSON.stringify(references);
          let revision: number | undefined;
          reportAdmission = async () => {
            const result = await stage.runPrivacy!.read(value.reportId);
            if (!result || typeof result.exists !== "boolean") throw new ZoteroError("zotero_unavailable");
            if (!result.item) throw new ZoteroError("zotero_report_not_found");
            const { run, state } = result.item;
            if (!result.exists || !state || !Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.erased !== "boolean"
              || !["private", "unlisted", "public"].includes(state.visibility)) throw new ZoteroError("zotero_unavailable");
            if (state.erased || state.visibility !== "public") throw new ZoteroError("zotero_report_not_found");
            if (run.id !== record.run.id || run.createdAt !== record.run.createdAt || revision !== undefined && state.revision !== revision
              || JSON.stringify(zoteroReportReferences(run, baseUrl)) !== expected) throw new ZoteroError("zotero_conflict");
            revision = state.revision;
          };
          await reportAdmission();
        }
      }
      return json(await service.send(context.wallet, value.collection, references, req.signal, reportAdmission));
    } catch (error) {
      const code = error instanceof ZoteroError ? error.code : "zotero_unavailable";
      return json({ error: code }, code === "zotero_report_not_found" ? 404 : code === "zotero_limit" ? 422 : ["zotero_conflict", "zotero_library_bound", "zotero_busy", "zotero_disconnected"].includes(code) ? 409 : code === "zotero_backoff" ? 429 : code === "zotero_scopes" ? 403 : 503);
    }
  }
  return { status: (req: Request) => execute(req, "status"), connect: (req: Request) => execute(req, "connect"), revoke: (req: Request) => execute(req, "revoke"),
    collections: (req: Request) => execute(req, "collections"), send: (req: Request) => execute(req, "send") };
}
