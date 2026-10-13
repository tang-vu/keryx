import { createOwnedHistoryClient } from "./owned-history-client";
import { historyCsv } from "./owned-history-csv";
import { parseOwnedQuery } from "./owned-history";

const filters = new Set(["search", "surface", "network", "funding", "visibility", "from", "to", "limit", "cursor"]);
const usage = "Usage: node --import tsx scripts/history.mts list|export [--search TEXT] [--surface SURFACE] [--network NETWORK] [--funding COHORT] [--visibility VISIBILITY] [--from UTC] [--to UTC] [--limit 1..50] [--cursor CURSOR] [--format json|csv]. Requires KERYX_API_KEY with explicit history:read; KERYX_BASE_URL defaults to https://keryx.cc. Current-store metadata only; exports carry completion/truncation. No signer, research, privacy mutation or stored-answer translation.";

export interface OwnedHistoryCliDependencies {
  key?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  write(text: string): void;
  error(text: string): void;
}

/** GET-only adapter. No env files, database, signer, payment driver, retries or owner selectors. */
export async function runOwnedHistoryCli(args: readonly string[], io: OwnedHistoryCliDependencies): Promise<number> {
  if (args.length === 1 && args[0] === "--help") { io.write(usage + "\n"); return 0; }
  let operation: "list" | "export", format = "json";
  const params = new URLSearchParams();
  try {
    if (args[0] !== "list" && args[0] !== "export") throw new Error("Invalid command");
    operation = args[0];
    const seen = new Set<string>();
    for (let index = 1; index < args.length; index += 2) {
      const option = args[index], value = args[index + 1];
      if (!option.startsWith("--") || value === undefined) throw new Error("Invalid option");
      const name = option.slice(2);
      if (seen.has(name)) throw new Error("Duplicate option");
      seen.add(name);
      if (name === "format" && operation === "export" && (value === "json" || value === "csv")) format = value;
      else if (filters.has(name)) params.append(name, value);
      else throw new Error("Unknown option");
    }
    const input = parseOwnedQuery(params);
    const client = createOwnedHistoryClient(io.baseUrl ?? "https://keryx.cc", () => io.key, io.fetcher);
    if (operation === "list") io.write(JSON.stringify(await client.read(input)) + "\n");
    else {
      const value = await client.export(input);
      io.write(format === "csv" ? historyCsv(value) : JSON.stringify(value) + "\n");
    }
    return 0;
  } catch {
    // Do not print raw provider errors, credentials, private response bodies or arbitrary argv.
    io.error("Owned history refused or unavailable. Use an explicit history:read key, HTTPS origin and valid bounded filters. No research or payment performed.\n");
    return 1;
  }
}
