import { getDb } from "../db";
import { getSession } from "../auth";
import { privacyBinding } from "./auth";
import { privacyReadsActive, requirePrivacy, type PrivacyStage, type RunVisibility } from "./contracts";
import { PublicationError, researchPublication } from "./publication";

export interface ResearchVisibilityContext {
  wallet: string | null;
  defaultVisibility: RunVisibility;
  privacyActive: boolean;
}

function creationPrivacyActive(db: PrivacyStage): boolean {
  // Closed legacy facades have no privacy domain and reject unknown property reads.
  // A captured domain or an ON rollout still uses the authoritative fail-closed check.
  if (process.env.KERYX_RUN_PRIVACY_ENABLED !== "true" && !Object.hasOwn(db, "runPrivacyActive") && !Object.hasOwn(db, "runPrivacy")) return false;
  return privacyReadsActive(db);
}

export async function readResearchVisibility(): Promise<ResearchVisibilityContext> {
  const wallet = (await getSession())?.address.toLowerCase() ?? null;
  const db = await getDb(), active = creationPrivacyActive(db);
  const store = active ? requirePrivacy(db) : undefined;
  if (store) await store.creationReady();
  return { wallet, privacyActive: active,
    defaultVisibility: wallet && store ? await store.defaults({ wallet, binding: privacyBinding() }) : "public" };
}

/** Capture publication intent before any inference or payment; body addresses grant no ownership. */
export async function prepareAskPublication(request: Request, requested: unknown, wallet?: string, parentVisibility?: RunVisibility) {
  const expected = request.headers.get("X-Keryx-Expected-Wallet");
  if (expected !== null && expected !== (wallet ?? "anonymous"))
    throw new PublicationError("owner_changed", 409, "Your signed-in account changed. Review visibility before submitting again.");
  const db = await getDb(), active = creationPrivacyActive(db);
  const store = active ? requirePrivacy(db) : undefined;
  const defaultVisibility = requested === undefined && wallet && store
    ? await store.defaults({ wallet, binding: privacyBinding() }) : "public";
  const visibility = researchPublication({ requested, defaultVisibility, parentVisibility, privacyActive: active, hasOwner: !!wallet });
  if (store) await store.creationReady();
  return { visibility, privacyActive: active };
}
