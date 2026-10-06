import { parseArgs } from "node:util";
import { parsePaperRequest } from "../lib/papers/request";
import { searchPaperLibrary } from "../lib/papers/search";

const { values } = parseArgs({ options: { q: { type: "string" }, author: { type: "string" },
  year: { type: "string" }, doi: { type: "string" }, search: { type: "boolean" }, help: { type: "boolean" } }, strict: true });
if (values.help) {
  console.log("Usage: npm run papers -- --q <title/topic> [--author <name>] [--year <YYYY>] [--doi <DOI>] [--search]\nDefault: curated bibliography only, no network or database. --search sends the query to official scholarly services; it does not read paper text, run a model or make payments.");
} else {
  const params = new URLSearchParams();
  for (const key of ["q", "author", "year", "doi"] as const) if (values[key]) params.set(key, values[key]);
  if (values.search) params.set("search", "1");
  try {
    const query = parsePaperRequest(params);
    console.log(JSON.stringify(await searchPaperLibrary(query.filters, { live: query.live }), null, 2));
  } catch { console.error("Invalid paper query or unavailable bibliography. See npm run papers -- --help."); process.exitCode = 1; }
}
