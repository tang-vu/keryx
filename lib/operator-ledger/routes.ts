import { operatorLedgerCsv, operatorLedgerJson, verifyOperatorLedger } from "./export";
import type { OperatorLedger } from "./contracts";

export function ledgerWindow(params: URLSearchParams): number {
  if ([...params.keys()].some(key => !["days", "format", "download"].includes(key)) || [...params.keys()].some(key => params.getAll(key).length !== 1))
    throw new Error("Invalid ledger request");
  const days = params.get("days") ?? "7";
  if (!/^(?:[1-9]|[12][0-9]|3[01])$/.test(days)) throw new Error("Invalid ledger window");
  if (params.has("format") && !["json", "csv"].includes(params.get("format")!) || params.has("download") && params.get("download") !== "1")
    throw new Error("Invalid ledger export");
  return Number(days);
}

export async function operatorLedgerResponse(request: Request, read: (days: number) => Promise<OperatorLedger>) {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  let days: number, params: URLSearchParams;
  try { params = new URL(request.url).searchParams; days = ledgerWindow(params); }
  catch { return Response.json({ error: "Invalid ledger request" }, { status: 400, headers }); }
  try {
    const ledger = verifyOperatorLedger(await read(days));
    const csv = params.get("format") === "csv";
    headers.set("X-Keryx-Ledger-Digest", ledger.integrity.digest);
    headers.set("Content-Type", csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
    if (csv || params.get("download") === "1") headers.set("Content-Disposition", `attachment; filename="keryx-public-transfer-ledger-${days}d.${csv ? "csv" : "json"}"`);
    return new Response(csv ? operatorLedgerCsv(ledger) : operatorLedgerJson(ledger), { headers });
  } catch { return Response.json({ error: "Public transfer ledger unavailable" }, { status: 503, headers }); }
}
