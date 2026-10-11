import { createEvidenceDraftRoute } from "@/lib/research/evidence-draft-route";
import { authorizePrivateDraftRequest } from "@/lib/research/private-draft-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createEvidenceDraftRoute(authorizePrivateDraftRequest);
