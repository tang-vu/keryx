/** Browser creation context and public population; paid agent ingress retains its own contract. */
export const researchPublicationOpenApiPaths = {
  "/api/ask/visibility": { get: {
    operationId: "readResearchCreationVisibility", tags: ["Research"],
    summary: "Read the browser's verified owner and default research visibility",
    security: [{}, { WebSession: [] }],
    description: "No-store browser context. Returns wallet (or null), defaultVisibility and privacyActive. An absent saved preference defaults to public; saved private/unlisted preferences remain authoritative. Browser POST /api/ask accepts visibility=public|unlisted|private and X-Keryx-Expected-Wallet (verified wallet or anonymous) as a comparison-only precondition. Private requires a signed-in owner; hidden-parent follow-ups cannot become more public. Unsupported active creation storage refuses before research. This does not add creation fields to paid agent/chat APIs or private jobs.",
    responses: {
      "200": { description: "Verified owner, supported privacy state and effective default; never cached." },
      "503": { description: "visibility_unavailable; choices must remain unavailable until a successful retry." },
    },
  } },
  "/api/runs/summary": { get: {
    operationId: "readPublicResearchPopulation", tags: ["Research"],
    summary: "Count the complete bounded public research population for a network and window",
    security: [],
    description: "Current database only, excluding hidden/erased questions and scripted runs by default. publicQuestions comes from the complete bounded classified population, independently of the recent-history sample. Unattributed records do not acquire a network. Recorded activity and financial totals are separate. No-store; unavailable reads return 503 with complete=false and no numeric fallback. These are fresh publication observations, not an atomic cross-RPC snapshot.",
    parameters: [
      { name: "network", in: "query", schema: { type: "string" }, description: "Supported canonical network ID." },
      { name: "period", in: "query", schema: { type: "string", enum: ["all", "7d", "30d"] } },
      { name: "since", in: "query", schema: { type: "string", format: "date" }, description: "UTC date YYYY-MM-DD, only with period=all; returns a custom window." },
      { name: "cohort", in: "query", schema: { type: "string", enum: ["default", "outside", "team", "scripted", "unknown"] } },
    ],
    responses: {
      "200": { description: "complete=true, network, period, since/until, cohort, publicQuestions and population basis." },
      "400": { description: "invalid_usage_filter; archive is not a current database population." },
      "503": { description: "public_history_summary_unavailable, complete=false; no reported question count." },
    },
  } },
};
