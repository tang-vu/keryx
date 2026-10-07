import { admitPaperSearch } from "./request";
import { paperLookupParameters, type PaperLookupInput } from "./lookup";
import { searchPaperLibrary } from "./search";

/** Shares public API admission; metadata remains available independently of paid research holds. */
export function readHostedPaperLookup(input: PaperLookupInput, caller: string, signal?: AbortSignal) {
  const { filters, live } = paperLookupParameters(input);
  if (live && admitPaperSearch(caller)) throw new Error("Bibliography admission busy");
  return searchPaperLibrary(filters, { live, signal });
}
