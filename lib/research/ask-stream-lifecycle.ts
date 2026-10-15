/** SSE comments keep long inference waits active without creating agent decisions. */
export const ASK_STREAM_HEARTBEAT_MS = 15_000;

export function askStreamWriter(controller: ReadableStreamDefaultController<Uint8Array>, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let stopped = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    stopped = true;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    signal.removeEventListener("abort", stop);
  };
  const write = (frame: string) => {
    if (stopped) return;
    try { controller.enqueue(encoder.encode(frame)); }
    catch { stop(); }
  };
  if (signal.aborted) stop();
  else {
    signal.addEventListener("abort", stop, { once: true });
    write(": connected\n\n");
    if (!stopped) {
      heartbeat = setInterval(() => write(": keepalive\n\n"), ASK_STREAM_HEARTBEAT_MS);
      heartbeat.unref?.();
    }
  }
  return {
    send(event: string, data: unknown) {
      try { write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
      catch { /* Serialization/delivery cannot reopen a disconnected stream. */ }
    },
    close() {
      stop();
      try { controller.close(); } catch { /* A cancelled reader is already closed. */ }
    },
  };
}

/** Only ordinary link-readable reports get a manual, same-origin recovery action. */
export function savedReportRecoveryPath(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const { reportId, visibility } = meta as { reportId?: unknown; visibility?: unknown };
  if (visibility !== "public" && visibility !== "unlisted") return null;
  return typeof reportId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reportId)
    ? `/dispatch/${reportId}` : null;
}
