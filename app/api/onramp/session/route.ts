/**
 * GET  /api/onramp/session — public environment and bank capability (no authentication/secrets).
 * POST /api/onramp/session — mint one Arc Onramp widget session for the signed-in wallet.
 *
 * The delivery address is the authenticated web-session wallet. The request body is never read,
 * so a caller cannot direct a purchase to another address or widen what the widget offers.
 */
import { authJson } from "@/lib/auth-challenge";
import { accountSessionContext, sessionMutationOrigin } from "@/lib/account-sessions";
import { checkRateLimit } from "@/lib/rate-limit";
import { arcCardOnrampAvailability, arcCardOnrampReady, mintArcCardOnrampSession } from "@/lib/onramp/arc-card-onramp";

export const runtime = "nodejs";

export async function GET() { return authJson(arcCardOnrampAvailability()); }

export async function POST(request: Request) {
  if (!arcCardOnrampReady()) return authJson({ error: "USDC funding is unavailable. No purchase session was prepared." }, 503);
  const origin = sessionMutationOrigin(request);
  if (origin) return origin;
  const owner = await accountSessionContext();
  if (owner instanceof Response) return owner;
  if (!owner || typeof owner.wallet !== "string") return authJson({ error: "Sign in with your wallet before buying USDC." }, 401);
  const limited = await checkRateLimit(`card-onramp:${owner.wallet}`, "cardOnramp");
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  try {
    return authJson({ session: await mintArcCardOnrampSession(owner.wallet) });
  } catch {
    return authJson({ error: "USDC funding is unavailable. No purchase session was prepared." }, 503);
  }
}
