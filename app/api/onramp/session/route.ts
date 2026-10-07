/**
 * GET  /api/onramp/session — whether card funding is configured (no authentication, no secrets).
 * POST /api/onramp/session — mint one Arc Onramp widget session for the signed-in wallet.
 *
 * The delivery address is the authenticated web-session wallet. The request body is never read,
 * so a caller cannot direct a purchase to another address or widen what the widget offers.
 */
import { authJson } from "@/lib/auth-challenge";
import { accountSessionContext, sessionMutationOrigin } from "@/lib/account-sessions";
import { checkRateLimit } from "@/lib/rate-limit";
import { arcCardOnrampReady, mintArcCardOnrampSession } from "@/lib/onramp/arc-card-onramp";

export const runtime = "nodejs";

export async function GET() { return authJson({ available: arcCardOnrampReady() }); }

export async function POST(request: Request) {
  if (!arcCardOnrampReady()) return authJson({ error: "Card funding is not configured." }, 503);
  const origin = sessionMutationOrigin(request);
  if (origin) return origin;
  const owner = await accountSessionContext();
  if (owner instanceof Response) return owner;
  const limited = await checkRateLimit(`card-onramp:${owner.wallet}`, "cardOnramp");
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  try {
    return authJson({ session: await mintArcCardOnrampSession(owner.wallet) });
  } catch {
    return authJson({ error: "Card funding is unavailable. No purchase was started." }, 503);
  }
}
