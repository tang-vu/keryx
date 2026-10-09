import { ZodError } from "zod";
import { hasScope, parseScopes } from "../api-key-scopes";
import { authJson } from "../auth-challenge";
import type { KeryxDB } from "../db/keryx-db";
import { PrivateProfileError, privateProfileInputSchema, profileWallet, requirePrivateProfiles } from "./private-profile";

interface Dependencies {
  session(): Promise<{ db: KeryxDB; wallet: string } | Response>;
  key(raw: string): Promise<{ walletAddress: string; scopes: string | null } | null>;
  db(): Promise<KeryxDB>;
  network: string;
}
async function readBody(req: Request) {
  if (!req.body || !req.headers.get("content-type")?.startsWith("application/json")) throw new Error("Use JSON");
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error("Body deadline")); void reader.cancel().catch(() => undefined); }, 5000); });
  try {
    for (;;) { const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
      size += value.length; if (size > 8192) throw new Error("Profile body too large"); chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return privateProfileInputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
function errorResponse(error: unknown) {
  if (error instanceof PrivateProfileError && error.code === "handle_conflict") return authJson({ error: "handle_conflict", message: "That handle is unavailable." }, 409);
  if (error instanceof ZodError) return authJson({ error: "invalid_profile", message: "Check the profile fields and allowed links." }, 400);
  return authJson({ error: "profile_unavailable", message: "Private profiles are unavailable on this storage deployment." }, 503);
}

/** Owner never comes from the body or URL. Bearer presence cannot silently select cookie authority. */
export function createProfileRoutes(deps: Dependencies) {
  const authenticate = async (req: Request, write: boolean) => {
    const header = req.headers.get("authorization");
    const expected = req.headers.get("x-keryx-expected-wallet");
    if (expected !== null && !/^0x[0-9a-fA-F]{40}$/.test(expected)) return authJson({ error: "invalid_owner_precondition" }, 400);
    const mismatch = (wallet: string) => expected !== null && expected.toLowerCase() !== profileWallet(wallet);
    if (header !== null) {
      if (!/^Bearer kx_live_[0-9a-f]{96}$/.test(header)) return authJson({ error: "unauthenticated" }, 401);
      const key = await deps.key(header.slice(7));
      if (!key) return authJson({ error: "unauthenticated" }, 401);
      if (!hasScope(parseScopes(key.scopes), write ? "profile:write" : "profile:read")) return authJson({ error: "insufficient_scope" }, 403);
      if (mismatch(key.walletAddress)) return authJson({ error: "profile_owner_changed", message: "Your signed-in owner changed. Reload the profile before changing it." }, 409);
      return { db: await deps.db(), wallet: key.walletAddress };
    }
    if (write) {
      try { if (req.headers.get("origin") !== new URL(req.url).origin) return authJson({ error: "same_origin_required" }, 403); }
      catch { return authJson({ error: "same_origin_required" }, 403); }
      if (expected === null) return authJson({ error: "owner_precondition_required", message: "Send X-Keryx-Expected-Wallet from the current editor." }, 428);
    }
    const context = await deps.session();
    if (!(context instanceof Response) && mismatch(context.wallet)) return authJson({ error: "profile_owner_changed", message: "Your signed-in owner changed. Reload the profile before changing it." }, 409);
    return context;
  };
  const execute = async (req: Request, operation: "get" | "update" | "delete") => {
    try {
      if (new URL(req.url).search) return authJson({ error: "invalid_profile", message: "Profile requests do not accept selectors." }, 400);
      const context = await authenticate(req, operation !== "get");
      if (context instanceof Response) return context;
      const store = requirePrivateProfiles(context.db);
      if (operation === "get") return authJson(await store.get(context.wallet, deps.network));
      if (operation === "delete") { await store.delete(context.wallet); return authJson({ deleted: true }); }
      let input;
      try { input = await readBody(req); } catch { return authJson({ error: "invalid_profile", message: "Use a bounded JSON profile with one-line text and allowed HTTPS links." }, 400); }
      return authJson({ profile: await store.update(context.wallet, input) });
    } catch (error) { return errorResponse(error); }
  };
  return { GET: (req: Request) => execute(req, "get"), PUT: (req: Request) => execute(req, "update"), DELETE: (req: Request) => execute(req, "delete") };
}
