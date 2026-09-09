import { createHash } from "node:crypto";
import { z } from "zod";

export const AUTH_CHALLENGE_TTL_MS = 300_000;
export const authNonceSchema = z.string().regex(/^[a-zA-Z0-9]{8,64}$/);
export const authChallengeHash = (nonce: string) => createHash("sha256")
  .update(`keryx-siwe-v1:${authNonceSchema.parse(nonce)}`).digest("hex");

export function authJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

const signInSchema = z.object({ message: z.string().min(1).max(8192),
  signature: z.string().min(4).max(2048).regex(/^0x[a-fA-F0-9]+$/) }).strict();

/** Bound bytes before parsing, including chunked requests with no content-length. */
export async function readSignInBody(request: Request) {
  if (!request.body) throw new Error("Missing sign-in body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Sign-in body deadline exceeded"));
      void reader.cancel().catch(() => undefined);
    }, 10000);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.length;
      if (length > 16384) throw new Error("Sign-in body too large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return signInSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally { clearTimeout(timer); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
