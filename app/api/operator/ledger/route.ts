import { operatorLedgerResponse } from "@/lib/operator-ledger/routes";
import { readSelectedOperatorLedger } from "@/lib/operator-ledger/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public persisted web-dispatch transfer evidence only. No private inspection delegation. */
export function GET(request: Request) { return operatorLedgerResponse(request, readSelectedOperatorLedger); }
