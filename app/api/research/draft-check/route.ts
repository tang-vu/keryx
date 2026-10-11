import { createDraftCheckRoute } from "@/lib/research/draft-check-route";
import { authorizePrivateDraftRequest } from "@/lib/research/private-draft-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createDraftCheckRoute(authorizePrivateDraftRequest);
