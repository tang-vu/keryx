/**
 * Operational errors from RPC/HTTP clients often echo the full request URL. Keryx RPC endpoints
 * may carry provider credentials in their path, so logs retain the error class/status but redact
 * every URL and cap the remaining text. This is presentation-only; the original error still drives
 * retry/checkpoint behavior.
 */
export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\b(?:https?|wss?):\/\/[^\s]+/gi, "[redacted URL]").slice(0, 1_000);
}
