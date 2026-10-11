import { sourceLearningId, validateSourceLearningReport } from "./source-learning-contract";

export async function sourceLearningResponse(request: Request, id: string, read: (id: string) => Promise<unknown | null>) {
  const headers = { "Cache-Control": "no-store" };
  const json = (value: unknown, status: number) => Response.json(value, { status, headers });
  if (!sourceLearningId.safeParse(id).success || new URL(request.url).searchParams.size)
    return json({ error: "Invalid source-learning request" }, 400);
  try {
    const result = await read(id);
    if (result === null) return json({ error: "Source not found" }, 404);
    return json(validateSourceLearningReport(result, id), 200);
  } catch { return json({ error: "Source learning record unavailable" }, 503); }
}
