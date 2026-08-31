/**
 * GET /api/docs — Scalar API reference UI.
 *
 * ApiReference() returns a Next.js-compatible route handler function directly.
 * Points at /api/openapi.json so the spec is always in sync with the live spec route.
 */

import { ApiReference } from "@scalar/nextjs-api-reference";
import { SCALAR_API_REFERENCE_SCRIPT_URL } from "@/lib/security-headers";

export const runtime = "nodejs";

export const GET = ApiReference({
  cdn: SCALAR_API_REFERENCE_SCRIPT_URL,
  spec: { url: "/api/openapi.json" },
  pageTitle: "Keryx API Reference",
  darkMode: true,
});
