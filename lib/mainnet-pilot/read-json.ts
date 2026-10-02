/** Bound bytes while reading, before JSON parsing; errors never include caller data. */
export async function readPilotJson(request: Request, maxBytes = 8192): Promise<unknown> {
  if (!request.body) throw new Error("Pilot input refused");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Pilot input refused"); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw new Error("Pilot input refused"); }
  finally { reader.releaseLock(); }
}
