/** Browser-only adapter over the existing hosted research contract. No signer or retry. */
export function sourceBudget(value) {
  const budget = typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(budget) || budget < 0 || budget > 0.08) {
    throw new Error("Enter a source budget from $0 to $0.08.");
  }
  return budget;
}

export function publicPageUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

export function researchQuestion(question, pageUrl, includePage) {
  const text = question.trim();
  if (!text) throw new Error("Enter a question first.");
  const url = includePage ? publicPageUrl(pageUrl) : null;
  if (includePage && !url) throw new Error("This page has no supported web URL. Ask without the page URL.");
  const result = url ? `${text}\n\nSource page to consider: ${url}` : text;
  if (result.length > 2000) throw new Error("Keep the question and optional page URL within 2,000 characters.");
  return result;
}

export function hostedReportUrl(value, origin) {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(origin).origin || url.username || url.password || url.search || url.hash ||
      // Public runs use UUIDs or the existing deterministic A2A original ID.
      !/^\/dispatch\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|a2a_[a-f0-9]{64})$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

/** Caller-private packet only, never accepted as a report/recent/export URL. */
export function privateClaimDelivery(packet, origin, runId) {
  if (!packet || Object.keys(packet).sort().join(",") !== "delivery,runId,status,version" || packet.version !== 1
    || packet.status !== "available" || packet.runId !== runId || typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(runId)
    || runId.startsWith("prv_") || runId.startsWith("a2a_")) return null;
  const delivery = packet.delivery;
  if (!delivery || Object.keys(delivery).sort().join(",") !== "claimUrl,expiresAt,version" || delivery.version !== 1
    || typeof delivery.expiresAt !== "string" || !Number.isFinite(Date.parse(delivery.expiresAt))
    || new Date(delivery.expiresAt).toISOString() !== delivery.expiresAt || Date.parse(delivery.expiresAt) <= Date.now()) return null;
  try {
    const url = new URL(delivery.claimUrl);
    if (url.href !== delivery.claimUrl || url.origin !== new URL(origin).origin || url.pathname !== "/claim-run" || url.search
      || url.username || url.password || !/^#[a-f0-9]{64}$/.test(url.hash)) return null;
    return { claimUrl: url.href, expiresAt: delivery.expiresAt };
  } catch { return null; }
}

export function webDraftUrl(origin, question, budget, mode) {
  const url = new URL(origin);
  url.searchParams.set("q", question);
  url.searchParams.set("budget", String(budget));
  url.searchParams.set("mode", mode);
  // Deliberately omit run=1: opening a draft cannot buy or dispatch research.
  return url.href;
}

export function responseError(body, status) {
  const message = body?.error?.message ?? body?.message;
  return typeof message === "string" && message ? message : `Keryx returned ${status}.`;
}

/** Parse the actual SSE protocol, including split UTF-8/CRLF frames and terminal errors. */
export async function readResearchStream(response, onChunk) {
  if (!response.body) throw new Error("Keryx returned no response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let finalSummary = false;
  const frame = event => {
    const data = event.split("\n").filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n").trim();
    if (!data) return;
    if (data === "[DONE]") { completed = true; return; }
    if (completed) throw new Error("Unexpected data after the response ended.");
    let chunk;
    try { chunk = JSON.parse(data); } catch { throw new Error("The research stream contained an unreadable event."); }
    const content = chunk?.choices?.[0]?.delta?.content;
    if (chunk?.keryx_error || typeof content === "string" && content.trimStart().startsWith("[keryx error]")) {
      throw new Error(typeof content === "string" ? content.replace(/^\s*\[keryx error\]\s*/, "") :
        "Research could not finish. Inspect the report before starting another request.");
    }
    onChunk(chunk);
    if (chunk?.keryx && chunk?.choices?.[0]?.finish_reason === "stop") finalSummary = true;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 1_048_576) throw new Error("The research event exceeded the supported size.");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        frame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) frame(buffer);
    if (!completed || !finalSummary) throw new Error("The research stream ended before completion. Inspect the report before starting another request.");
  } finally {
    try { await reader.cancel(); } catch { /* A disconnected transport may already be closed. */ }
    reader.releaseLock();
  }
}
