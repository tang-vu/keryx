import { runClaimsEnabled } from "@/lib/run-claims/contracts";
import { runClaimLandingResponse } from "@/lib/run-claims/landing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return runClaimLandingResponse(runClaimsEnabled(process.env)); }
