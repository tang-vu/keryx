/** Bound actual streamed bytes, including requests without Content-Length. */
export async function readMcpBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Invalid MCP body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Invalid MCP body")), 5000);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error("Invalid MCP body");
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
