/**
 * OpenAI-compatible model list. Many clients GET /v1/models on connect to populate a picker or
 * verify the base_url; without it they error before the first chat call. "keryx" is the research
 * agent itself (default reasoning model); "keryx:<id>" runs the same agent with that catalog
 * model as its brain — any pick that fails falls back to DeepSeek, then the offline heuristic.
 */

import { availableModels } from "@/lib/llm";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET() {
  const data = [
    { id: "keryx", object: "model", created: 1750000000, owned_by: "keryx" },
    ...availableModels().map((m) => ({
      id: `keryx:${m.id}`,
      object: "model",
      created: 1750000000,
      owned_by: "keryx",
    })),
  ];
  return Response.json({ object: "list", data }, { headers: CORS });
}
