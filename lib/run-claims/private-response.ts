export const runClaimPrivateHeaders = [
  { key: "Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
] as const;
export function privateRunResponse(response: Response): Response {
  for (const header of runClaimPrivateHeaders) response.headers.set(header.key, header.value);
  response.headers.set("Vary", "Cookie, Authorization, X-Keryx-Expected-Wallet");
  return response;
}
