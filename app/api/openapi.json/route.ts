/**
 * GET /api/openapi.json — serves the hand-written OpenAPI 3.1 spec.
 */

import { openapiSpec } from "@/lib/openapi-spec";

export const runtime = "nodejs";

export function GET() {
  return Response.json(openapiSpec, {
    headers: {
      // Allow Scalar UI (same origin) and external API explorers to fetch the spec.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
  });
}
