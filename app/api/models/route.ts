/**
 * Public model list for the ask form's picker. Returns only the catalog entries whose
 * provider credentials are configured, so the UI never offers a model that can't run.
 * (Every pick still has a configured-provider → heuristic fallback chain server-side.)
 */

import { availableModels } from "@/lib/llm";
import { DEFAULT_MODEL_ID } from "@/lib/llm/model-catalog";

export const dynamic = "force-dynamic";

export function GET() {
  const models = availableModels().map((m) => ({ id: m.id, label: m.label, note: m.note }));
  return Response.json(
    { default: DEFAULT_MODEL_ID, models },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
