import { runClaimPrivateHeaders } from "./private-headers.cjs";
export { runClaimPrivateHeaders } from "./private-headers.cjs";
export function privateRunResponse(response: Response): Response {
  for (const header of runClaimPrivateHeaders) response.headers.set(header.key, header.value);
  response.headers.set("Vary", "Cookie, Authorization, X-Keryx-Expected-Wallet");
  return response;
}
