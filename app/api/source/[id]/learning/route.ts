import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { readSourceLearning } from "@/lib/research/source-learning-server";
import { sourceLearningResponse } from "@/lib/research/source-learning-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return sourceLearningResponse(request, id, async sourceId => readSourceLearning(await getDb(), sourceId, config.networkId));
}
