import type { KeryxDB } from "../db/keryx-db";
import { isConfiguredSameOrigin } from "../auth-origin";
import { bibliographyIdSchema, bibliographyInputSchema, bibliographyOwner, bibliographyRevisionSchema,
  MAX_BIBLIOGRAPHY_BODY_BYTES, PrivateBibliographyError, requirePrivateBibliographies } from "./private-bibliography";

type Session = () => Promise<{ db: KeryxDB; wallet: string } | Response>;
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: privateHeaders }); }
function failure(error: unknown) {
  const code = error instanceof PrivateBibliographyError ? error.code : "bibliography_unavailable";
  return json({ error: code }, code === "bibliography_not_found" ? 404 : code === "bibliography_conflict" ? 409 : code === "bibliography_limit" ? 422 : 503);
}
async function boundedInput(req: Request) {
  if (!req.body || !/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type") ?? "")) throw new Error("JSON required");
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error("Body deadline")); void reader.cancel().catch(() => undefined); }, 5000); });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
      size += value.length; if (size > MAX_BIBLIOGRAPHY_BODY_BYTES) throw new Error("Body limit"); chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bibliographyInputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
function expectedRevision(req: Request) {
  const header = req.headers.get("if-match"), match = header?.match(/^"([1-9]\d{0,9})"$/);
  return match ? bibliographyRevisionSchema.safeParse(Number(match[1])) : null;
}
/** Session-only explicit sharing: historical API keys gain no new private-write authority. */
export function createBibliographyManagement(session: Session, configuredBaseUrl: unknown) {
  async function execute(req: Request, operation: "list" | "create" | "replace" | "revoke", id?: string) {
    try {
      if (new URL(req.url).search || id !== undefined && !bibliographyIdSchema.safeParse(id).success) return json({ error: "invalid_bibliography" }, 400);
      if (req.headers.has("authorization")) return json({ error: "session_required" }, 401);
      const expected = req.headers.get("x-keryx-expected-wallet");
      if (expected === null) return json({ error: "owner_precondition_required" }, 428);
      if (!/^0x[0-9a-fA-F]{40}$/.test(expected)) return json({ error: "invalid_owner_precondition" }, 400);
      if (operation !== "list" && !isConfiguredSameOrigin(req, configuredBaseUrl)) return json({ error: "same_origin_required" }, 403);
      const context = await session();
      if (context instanceof Response) { const headers = new Headers(context.headers); for (const [key, value] of Object.entries(privateHeaders)) headers.set(key, value); return new Response(context.body, { status: context.status, headers }); }
      if (bibliographyOwner(context.wallet) !== expected.toLowerCase()) return json({ error: "bibliography_owner_changed" }, 409);
      let revision: number | undefined;
      if (operation === "replace" || operation === "revoke") {
        const parsed = expectedRevision(req);
        if (!parsed?.success) return json({ error: "revision_precondition_required" }, 428);
        revision = parsed.data;
      }
      const store = requirePrivateBibliographies(context.db);
      if (operation === "list") return json({ bibliographies: await store.list(context.wallet) });
      if (operation === "revoke") { await store.revoke(context.wallet, id!, revision!); return json({ revoked: true }); }
      let input;
      try { input = await boundedInput(req); } catch { return json({ error: "invalid_bibliography" }, 400); }
      if (operation === "replace") return json({ bibliography: await store.replace(context.wallet, id!, input, revision!) });
      const { bibliography, token } = await store.create(context.wallet, input);
      // One-time response only. The persisted row and owner listing retain no recoverable token.
      return json({ bibliography, urlPath: `/api/bibliographies/${token}.bib` }, 201);
    } catch (error) { return failure(error); }
  }
  return { list: (req: Request) => execute(req, "list"), create: (req: Request) => execute(req, "create"),
    replace: (req: Request, id: string) => execute(req, "replace", id), revoke: (req: Request, id: string) => execute(req, "revoke", id) };
}
/** Bearer capability can only read the one explicitly published metadata snapshot. */
export function createBibliographyDownload(database: () => Promise<KeryxDB>) {
  return async (req: Request, filename: string) => {
    if (new URL(req.url).search || !/^[0-9a-f]{64}\.bib$/.test(filename)) return json({ error: "bibliography_not_found" }, 404);
    try {
      const result = await requirePrivateBibliographies(await database()).read(filename.slice(0, -4));
      if (!result) return json({ error: "bibliography_not_found" }, 404);
      return new Response(result.content, { headers: { ...privateHeaders, "Content-Type": "application/x-bibtex; charset=utf-8", "Content-Disposition": 'attachment; filename="references.bib"' } });
    } catch (error) { return failure(error); }
  };
}
