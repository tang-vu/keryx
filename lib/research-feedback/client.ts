import { readBoundedJson } from "../read-bounded-json";
import { feedbackInputSchema, feedbackResponseSchema, type FeedbackInput } from "./contracts";

/** Explicit opinion only. Fixed endpoint, bearer header, no cookies, redirects,
 * credential URLs, research retries or payment fallback. */
export async function requestRequesterFeedback(origin: string, token: string, input?: FeedbackInput,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {}) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const target = new URL(origin);
    if (target.origin !== origin || target.username || target.password || target.pathname !== "/"
      || !/^https:$/.test(target.protocol) && !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) throw new Error();
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 2048) throw new Error();
    const response = await (options.fetch ?? fetch)(`${origin}/api/research-feedback`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input ? { operation: "submit", ...feedbackInputSchema.parse(input) } : { operation: "read" }),
      credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
    });
    if (!response.ok) throw new Error();
    return feedbackResponseSchema.parse(await readBoundedJson(response, 8192));
  } catch { throw new Error("Requester feedback could not be confirmed. No research or payment was started."); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
