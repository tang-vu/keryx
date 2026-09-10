import { privatePurchaseHandler } from "@/lib/a2a/private-purchase-handler";
import { privatePurchaseBootstrap } from "@/lib/a2a/private-purchase-bootstrap";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = privatePurchaseHandler({
  bootstrap: privatePurchaseBootstrap,
  limit: wallet => checkRateLimit(`private-purchase:${wallet}`, "ask"),
});
