import type {
  BrowserAuthorizationJournal,
  BrowserJournalAdmission,
} from "./browser-authorization-journal";
import type { SessionGrantRecord } from "./keryx-db";
import {
  verifyBrowserQueryPolicy,
  type BrowserQueryPolicyProof,
} from "../payments/browser-query-policy";
import { canonicalJson } from "../canonical-json";
import { prepareBrowserSigningOriginal } from "../payments/browser-signing-original";
import type { BrowserSigningOriginal } from "../payments/browser-signing-original";
export type BrowserQueryAdmissionResult =
  | { status: "admitted"; namespace: string; queryId: string }
  | { status: "inactive" | "refused" };
export interface BrowserOriginalAdmission {
  queryNamespace: string;
  queryId: string;
  journal: BrowserJournalAdmission;
}
export type BrowserOriginalAdmissionResult =
  | {
      status: "admitted";
      journal: BrowserAuthorizationJournal;
      original: BrowserSigningOriginal;
    }
  | { status: "inactive" | "refused" };
export interface BrowserSigningSnapshot {
  original: BrowserSigningOriginal;
  journal: BrowserAuthorizationJournal;
  currentGrant: SessionGrantRecord | null;
  policy: BrowserQueryPolicyProof;
  namespace: {
    namespace: string;
    owner: string;
    signer: string;
    service: string;
    network: string;
    ceilingMicros: string;
    jobLimit: number;
    allocatedMicros: string;
    jobs: number;
    ceilingProof: BrowserQueryPolicyProof;
  };
  query: {
    queryId: string;
    namespace: string;
    ceilingMicros: string;
    spentMicros: string;
    proofDigest: string;
  };
  signerSpentMicros: string;
  retainedEpochSpentMicros: string;
  active: boolean;
}
/** Revalidate persisted proof and all original bindings; reading never repairs history. */
export async function validateBrowserSigningSnapshot(
  value: BrowserSigningSnapshot,
  owner: string
): Promise<BrowserSigningSnapshot> {
  const snapshot = JSON.parse(canonicalJson(value)) as BrowserSigningSnapshot;
  const verified = await verifyBrowserQueryPolicy(snapshot.policy),
    p = verified.policy,
    n = snapshot.namespace,
    q = snapshot.query;
  const ceiling = await verifyBrowserQueryPolicy(n.ceilingProof);
  const validInteger = (value: string) =>
    typeof value === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value) &&
    BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
  if (
    owner.toLowerCase() !== p.owner ||
    n.owner !== p.owner ||
    n.signer !== p.signer ||
    n.service !== p.service ||
    n.network !== "eip155:5042002" ||
    n.namespace !== verified.namespace ||
    ceiling.namespace !== n.namespace ||
    n.ceilingMicros !== ceiling.policy.lifetimeCeilingMicros ||
    n.jobLimit !== ceiling.policy.jobLimit ||
    q.namespace !== n.namespace ||
    q.queryId !== p.queryId ||
    q.proofDigest !== verified.proofDigest ||
    q.ceilingMicros !== p.queryCeilingMicros ||
    snapshot.journal.grantEpoch !== p.grantEpoch ||
    snapshot.journal.signer.toLowerCase() !== p.signer ||
    snapshot.original.queryId !== q.queryId ||
    snapshot.journal.payment.queryId !== q.queryId ||
    ![
      n.ceilingMicros,
      n.allocatedMicros,
      q.ceilingMicros,
      q.spentMicros,
      snapshot.signerSpentMicros,
      snapshot.retainedEpochSpentMicros,
    ].every(validInteger) ||
    BigInt(n.allocatedMicros) > BigInt(n.ceilingMicros) ||
    BigInt(q.spentMicros) > BigInt(q.ceilingMicros) ||
    !Number.isSafeInteger(n.jobs) ||
    n.jobs < 0 ||
    !Number.isSafeInteger(n.jobLimit) ||
    n.jobs > n.jobLimit ||
    canonicalJson(snapshot.original) !==
      canonicalJson(
        prepareBrowserSigningOriginal(snapshot.journal, n.namespace)
      )
  )
    throw new Error("Browser original snapshot refused");
  function freeze(object: object): void {
    for (const child of Object.values(object))
      if (child && typeof child === "object") freeze(child);
    Object.freeze(object);
  }
  freeze(snapshot);
  return snapshot;
}
export interface BrowserSigningOriginalsBackend {
  admitBrowserQueryPolicy(
    proof: BrowserQueryPolicyProof,
    sessionId: string
  ): Promise<BrowserQueryAdmissionResult>;
  admitBrowserSigningOriginal(
    input: BrowserOriginalAdmission
  ): Promise<BrowserOriginalAdmissionResult>;
  readBrowserSigningSnapshot(
    owner: string,
    sessionId: string,
    requestId: string
  ): Promise<BrowserSigningSnapshot | null>;
  signBrowserSigningOriginal(
    sessionId: string,
    requestId: string,
    header: string
  ): Promise<boolean>;
}
