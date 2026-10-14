import { createPrivateJobHistoryClient, privateJobHistoryMetadataCsv, PRIVATE_JOB_HISTORY_ORIGIN,
  PRIVATE_JOB_HISTORY_REFUSAL } from "./private-job-history-client";
import { PRIVATE_JOB_HISTORY_BOUNDS as B, parsePrivateJobHistoryInput, privateJobHistoryDetailInputSchema,
  type PrivateJobHistoryInput } from "./private-job-history-contract";

export const PRIVATE_JOB_HISTORY_HELP = `Usage: node --import tsx scripts/private-job-history.mts list|detail|export [flags]
list/export: --limit 1..25 --cursor TOKEN --search TEXT --surface SURFACE --network eip155:5042|eip155:5042002 --from UTC --to UTC
detail: --id prv_<64 lowercase hex>
export: --format json|csv (default json)
All commands: --expected-wallet ADDRESS (mismatch precondition only)
Requires explicit KERYX_API_KEY with server-enforced history:read. Fixed HTTPS origin: ${PRIVATE_JOB_HISTORY_ORIGIN}.
Output is PRIVATE DATA for the authenticated caller. Detail explicitly reads one private answer; never a public link or model prompt.
List is a bounded scan. Export is manual metadata only, at most 20 pages/500 rows/2 MiB; inspect complete/truncated/nextCursor.
Own settled spend/creator rewards/paid creators stay NULL. No envfile, cookie, signer, research, payment, database fallback or mutation.
`;
export interface PrivateJobHistoryCliDependencies {
  key(): string | undefined;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  write(text: string): void;
  error(text: string): void;
}
const filterNames = new Set(["limit", "cursor", "search", "surface", "network", "from", "to"]);

/** Testable manual CLI adapter. Reject flags before any HTTPS IO; never echo argv/errors. */
export async function runPrivateJobHistoryCli(args: readonly string[], io: PrivateJobHistoryCliDependencies): Promise<number> {
  if (args.length === 1 && args[0] === "--help") { io.write(PRIVATE_JOB_HISTORY_HELP); return 0; }
  try {
    if (args.length > 21 || args.reduce((size, value) => size + new TextEncoder().encode(value).byteLength, 0) > B.requestBytes) throw new Error();
    const action = args[0];
    if (action !== "list" && action !== "detail" && action !== "export") throw new Error();
    const input: Record<string, unknown> = {}, seen = new Set<string>();
    let format = "json", expectedWallet: string | undefined;
    for (let index = 1; index < args.length; index += 2) {
      const flag = args[index], value = args[index + 1];
      if (!flag.startsWith("--") || value === undefined || seen.has(flag)) throw new Error();
      seen.add(flag); const name = flag.slice(2);
      if (name === "expected-wallet") {
        if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(); expectedWallet = value.toLowerCase();
      } else if (name === "format" && action === "export" && (value === "json" || value === "csv")) format = value;
      else if (name === "id" && action === "detail") input.id = value;
      else if (filterNames.has(name) && action !== "detail") {
        if (name === "limit") { if (!/^(?:[1-9]|1\d|2[0-5])$/.test(value)) throw new Error(); input.limit = Number(value); }
        else input[name] = value;
      } else throw new Error();
    }
    const parsed = action === "detail" ? privateJobHistoryDetailInputSchema.parse(input) : parsePrivateJobHistoryInput(input);
    const client = createPrivateJobHistoryClient(PRIVATE_JOB_HISTORY_ORIGIN, io.key, io.fetcher);
    const options = { expectedWallet, signal: io.signal };
    const value = action === "detail" ? await client.detail(parsed as { id: string }, options)
      : action === "export" ? await client.export(parsed as PrivateJobHistoryInput, options)
      : await client.list(parsed as PrivateJobHistoryInput, options);
    const output = action === "export" && format === "csv"
      ? privateJobHistoryMetadataCsv(value as Awaited<ReturnType<typeof client.export>>) : JSON.stringify(value) + "\n";
    if (new TextEncoder().encode(output).byteLength > (action === "export" ? B.exportBytes : action === "detail" ? B.detailBytes : B.pageBytes) + (format === "csv" ? 0 : 1)) throw new Error();
    client.current();
    if (io.signal?.aborted) throw new Error();
    io.write(output); return 0;
  } catch { io.error(PRIVATE_JOB_HISTORY_REFUSAL + " Use --help for bounded flags and explicit history-key requirements.\n"); return 1; }
}
