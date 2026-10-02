/** Forward one pinned signed request, then intentionally discard its real response. */
export function browserRehearsalTransport(endpoint: string, original: typeof fetch) {
  let paidCalls = 0;
  let responseObserved = false;
  const fetchImpl: typeof fetch = async (input, options) => {
    const headers = new Headers(options?.headers);
    if (!headers.has("payment-signature")) return original(input, options);
    if (String(input) !== endpoint || paidCalls !== 0)
      throw new Error("Rehearsal refuses another paid request or endpoint");
    paidCalls++;
    const response = await original(input, { ...options, redirect: "error" });
    await response.body?.cancel(); // Headers arrived; discard content without unbounded buffering.
    responseObserved = true;
    throw new Error("operator injected paid response loss");
  };
  return { fetchImpl, summary: () => ({ paidCalls, responseObserved }) };
}
