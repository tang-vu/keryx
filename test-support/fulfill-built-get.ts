import assert from "node:assert/strict";
import type { Route } from "playwright";

type BuiltGetRoute = Pick<Route, "fetch" | "fulfill"> & {
  request(): Pick<ReturnType<Route["request"]>, "url" | "method">;
};
export async function fulfillBuiltGet(route: BuiltGetRoute, physicalOrigin: string) {
  const request = route.request(), url = new URL(request.url());
  assert.equal(request.method(), "GET");
  const response = await route.fetch({ url: physicalOrigin + url.pathname + url.search });
  try {
    const body = await response.body(), headers = { ...response.headers() };
    // APIResponse bodies are decoded buffers, not the upstream compressed/chunked wire stream.
    for (const name of ["content-encoding", "transfer-encoding", "content-length", "connection", "keep-alive"])
      delete headers[name];
    await route.fulfill({ response, headers, body });
  } finally { await response.dispose(); }
}
