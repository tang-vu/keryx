import { http } from "viem";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Bound each complete RPC response, including its body. viem's current HTTP
 * timeout covers headers and an explicit fetchOptions.signal replaces its timeout
 * signal, so compose cancellation inside fetchFn instead. No automatic retries. */
export function withdrawalRpcTransport(rpcUrl: string, signal: AbortSignal) {
  let endpoint: string;
  try {
    const url = new URL(rpcUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    endpoint = url.toString();
  } catch { throw new Error("Withdrawal RPC unavailable"); }
  return http(endpoint, { retryCount: 0, timeout: 5000, maxResponseBodySize: MAX_BODY_BYTES,
    fetchFn: async (input, init) => {
      const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 5000);
      const combined = AbortSignal.any([signal, deadline.signal, ...(init?.signal ? [init.signal] : [])]);
      try {
        combined.throwIfAborted();
        const response = await fetch(input, { ...init, signal: combined });
        combined.throwIfAborted();
        const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
        let length = 0;
        if (reader) {
          try {
            for (;;) {
              const chunk = await reader.read(); combined.throwIfAborted();
              if (chunk.done) break;
              length += chunk.value.byteLength;
              if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("Withdrawal RPC response unavailable"); }
              chunks.push(chunk.value);
            }
          } finally { reader.releaseLock(); }
        }
        const body = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        const headers = new Headers(response.headers);
        headers.delete("content-encoding"); headers.delete("content-length");
        return new Response(length ? body : null, { status: response.status, statusText: response.statusText, headers });
      } finally { clearTimeout(timer); }
    } });
}
