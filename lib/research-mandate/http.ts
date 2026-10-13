import { MAX_MANDATE_BYTES } from "./limits";
export { MAX_MANDATE_BYTES } from "./limits";
export class MandateRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export function requireMandateOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new MandateRequestError(403, "Cross-origin assessment requests are refused");
}
/** Bound before JSON parsing, including when Content-Length is omitted or false. */
export async function readMandateBody(request: Request): Promise<unknown> {
  requireMandateOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new MandateRequestError(415, "Send application/json");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_MANDATE_BYTES))
    throw new MandateRequestError(413, "Assessment input exceeds 64 KiB");
  const reader = request.body?.getReader();
  if (!reader) throw new MandateRequestError(400, "A JSON input is required");
  let count = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > MAX_MANDATE_BYTES) throw new MandateRequestError(413, "Assessment input exceeds 64 KiB");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode(); return JSON.parse(text);
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof MandateRequestError) throw error;
    throw new MandateRequestError(400, "Invalid JSON input");
  } finally { reader.releaseLock(); }
}
export function mandateErrorResponse(error: unknown): Response {
  return Response.json({ error: error instanceof MandateRequestError ? error.message : "Invalid mandate policy or observations",
    executionAuthorized: false }, { status: error instanceof MandateRequestError ? error.status : 400,
    headers: { "Cache-Control": "no-store" } });
}
