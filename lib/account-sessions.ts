import { cookies } from "next/headers";
import { config } from "./config";
import { getDb } from "./db";
import { authJson } from "./auth-challenge";
import { isWebSessionActive, parseWebSession, webSessionHash } from "./auth-session";

/** No token or raw identifier leaves this boundary. Row hashes are selectors, never credentials. */
export async function accountSessionContext() {
  try {
    const claims = await parseWebSession((await cookies()).get("keryx_session")?.value, config.jwtSecret);
    if (!claims) return authJson({ error: "Sign in to manage your sessions." }, 401);
    const db = await getDb();
    if (!await isWebSessionActive(db, claims)) return authJson({ error: "Sign in to manage your sessions." }, 401);
    return { db, wallet: claims.address.toLowerCase(), currentId: webSessionHash(claims.jti) };
  } catch { return authJson({ error: "Session management is unavailable. Please retry." }, 503); }
}

export function sessionMutationOrigin(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== req.headers.get("host")) return authJson({ error: "Same-origin request required." }, 403);
  } catch { return authJson({ error: "Invalid origin." }, 403); }
  return null;
}
