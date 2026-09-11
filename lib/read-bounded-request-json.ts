/** Bound actual streamed bytes, including requests without Content-Length. */
export async function readBoundedRequestJson(request: Request, maxBytes = 65536): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536) throw new Error("Invalid request body limit");
  if (!request.body) throw new Error("Invalid request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Invalid request body")), 5000);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Invalid request body");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    clearTimeout(timer);
    // A hostile stream's cancellation promise must not extend the read deadline.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
