import { createEvidenceProcurementRoute } from "@/lib/evidence-procurement/route";
import { authorizePrivateDraftRequest } from "@/lib/research/private-draft-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createEvidenceProcurementRoute(authorizePrivateDraftRequest);
