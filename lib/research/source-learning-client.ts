import { readBoundedJson } from "../read-bounded-json";
import { sourceLearningId, validateSourceLearningReport } from "./source-learning-contract";

/** Public GET only. No account token, payment response handler or paid fallback. */
export async function fetchSourceLearning(origin: string, id: string) {
  sourceLearningId.parse(id);
  if (typeof origin !== "string" || origin.length > 2048 || /[\s\u0000-\u001f\u007f\\]/u.test(origin)) throw new Error("Source-learning origin refused");
  const base = new URL(origin);
  if (base.origin !== origin || base.username || base.password || base.protocol !== "https:" &&
    !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new Error("Source-learning origin refused");
  const response = await fetch(`${origin}/api/source/${id}/learning`, { method: "GET", cache: "no-store",
    credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new Error("Source learning record unavailable");
  return validateSourceLearningReport(await readBoundedJson(response, 64 * 1024), id);
}
