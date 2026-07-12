/**
 * OpenAI-compatible model list. Many clients GET /v1/models on connect to populate a picker or
 * verify the base_url; without it they error before the first chat call. Keryx exposes a single
 * logical model — the research agent itself.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET() {
  return Response.json(
    {
      object: "list",
      data: [
        {
          id: "keryx",
          object: "model",
          created: 1750000000,
          owned_by: "keryx",
        },
      ],
    },
    { headers: CORS },
  );
}
