/** Next may represent a bodyless mutation as a non-null stream. Admit only EOF
 * with zero bytes; headers cannot prove emptiness or extend the finite budget. */
export async function emptyIdentityRequestBody(request: Request): Promise<boolean> {
  if (request.signal.aborted || request.bodyUsed) return false;
  if (request.body === null) return true;
  if (request.body.locked) return false;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = request.body.getReader(); } catch { return false; }
  const cutoff = performance.now() + 5000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const stopped = new Promise<null>(resolve => {
    abort = () => resolve(null);
    timer = setTimeout(abort, 5000);
  });
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    for (let reads = 0; reads < 16; reads++) {
      if (request.signal.aborted || performance.now() >= cutoff) return false;
      const result = await Promise.race([reader.read(), stopped]);
      if (result === null || request.signal.aborted || performance.now() >= cutoff) return false;
      if (result.done) return true;
      if (!(result.value instanceof Uint8Array) || result.value.byteLength !== 0) return false;
    }
    return false;
  } catch { return false; }
  finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    // Neither a hostile cancellation promise nor lock cleanup may extend the
    // read budget or replace a deterministic invalid-request response.
    try { void reader.cancel().catch(() => undefined); } catch {}
    try { reader.releaseLock(); } catch {}
  }
}
