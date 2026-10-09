import { verifyApiKey } from "@/lib/api-keys";
import { createObligationRoute, configuredObligationReader } from "@/lib/operator-obligations/route";
import { inspectOperatorObligations } from "@/lib/operator-obligations/inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createObligationRoute({ reader: configuredObligationReader, key: verifyApiKey, inspect: inspectOperatorObligations });
