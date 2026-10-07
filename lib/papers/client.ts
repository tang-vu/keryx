import { readBoundedJson } from "../read-bounded-json";
import { paperLookupParameters, validatePaperLookupResult, type PaperLookupInput } from "./lookup";

/** GET-only bibliography. No buyer, signer, wallet, journal, original read or retry. */
export async function fetchPaperLookup(baseUrl: string, input: PaperLookupInput,
  http: (url: string, init: RequestInit) => Promise<Response> = fetch) {
  const { params } = paperLookupParameters(input);
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.port || base.search || base.hash || base.pathname !== "/")
    throw new Error("Invalid bibliography origin");
  const response = await http(`${base.origin}/api/papers?${params}`, {
    method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Bibliography unavailable"); }
  return validatePaperLookupResult(input, await readBoundedJson(response));
}
