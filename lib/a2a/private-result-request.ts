import { z } from "zod";
import { privateResearchIdSchema } from "./private-research-intent";

const schema = z.object({ id: privateResearchIdSchema }).strict();

/** Keep private selectors out of URLs; cap chunked request bytes and read duration. */
export async function readPrivateResultRequest(request: Request) {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error("Body deadline")); void reader.cancel().catch(() => undefined); }, 5000);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > 1024) throw new Error("Body too large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally { clearTimeout(timer); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
