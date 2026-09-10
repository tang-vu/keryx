/** Bound untrusted response bytes before JSON parsing; works in Node and browsers. */
export async function readBoundedJson(response: Response, maxBytes = 2_000_000): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16_777_216) throw new Error("Invalid response size limit");
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error(maxBytes === 2_000_000 ? "Buyer response exceeds 2 MB" : "Response exceeds size limit");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    // Buffer's previous UTF-8 decoding preserves BOM; retain that parser behavior.
    return JSON.parse(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
