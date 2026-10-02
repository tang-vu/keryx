import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson } from "../canonical-json";
import { verifyBrowserQueryPolicy, type BrowserQueryPolicyProof } from "../payments/browser-query-policy";
import { prepareBrowserSigningOriginal, verifyBrowserSigningHeader, type BrowserSigningOriginal } from "../payments/browser-signing-original";
import { prepareBrowserSourceSigningAdmission, assertVerifiedBrowserOriginalSourceContextCurrent, type BrowserOriginalSourceAuthority } from "../payments/browser-original-source-authority";
import { prepareBrowserJournal } from "./browser-authorization-journal";
import { validateBrowserSigningSnapshot, type BrowserOriginalAdmission, type BrowserOriginalAdmissionResult,
  type BrowserQueryAdmissionResult, type BrowserSigningSnapshot, type BrowserSourceOriginalAdmission } from "./browser-signing-originals";

function refuse(): never { throw new Error("Browser signing original backend refused"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse(); return value as Record<string, unknown>;
}
/** Privileged service composition remains trusted. SQL does not recover ECDSA. */
export async function admitSupabaseBrowserQueryPolicy(sb: SupabaseClient, proof: BrowserQueryPolicyProof, sessionId: string): Promise<BrowserQueryAdmissionResult> {
  const verified = await verifyBrowserQueryPolicy(proof);
  if (typeof sessionId !== "string" || !sessionId) refuse();
  const { data, error } = await sb.rpc("browser_signing_admit_query", { p_verified: verified, p_session_id: sessionId });
  if (error) refuse(); const result = object(data);
  if (result.status === "inactive" || result.status === "refused") return { status: result.status };
  if (result.status !== "admitted" || result.namespace !== verified.namespace || result.queryId !== verified.policy.queryId) refuse();
  return { status: "admitted", namespace: verified.namespace, queryId: verified.policy.queryId };
}
export async function admitSupabaseBrowserSigningOriginal(sb: SupabaseClient, input: BrowserOriginalAdmission): Promise<BrowserOriginalAdmissionResult> {
  input = JSON.parse(canonicalJson(input)) as BrowserOriginalAdmission;
  const journal = prepareBrowserJournal(input.journal), original = prepareBrowserSigningOriginal(journal, input.queryNamespace);
  if (input.queryId !== original.queryId) refuse();
  const { data, error } = await sb.rpc("browser_signing_admit_original", { p_input: input, p_journal: journal, p_original: original });
  if (error) refuse(); const result = object(data);
  if (result.status === "inactive" || result.status === "refused") return { status: result.status };
  if (result.status !== "admitted") refuse();
  const retained = JSON.parse(canonicalJson(result.snapshot)) as BrowserSigningSnapshot;
  const snapshot = await validateBrowserSigningSnapshot(retained, retained.namespace.owner);
  if (snapshot.query.namespace !== input.queryNamespace || snapshot.query.queryId !== input.queryId
    || snapshot.journal.sessionId !== input.journal.sessionId || snapshot.journal.requestId !== input.journal.requestId
    || snapshot.journal.grantEpoch !== input.journal.grantEpoch
    || snapshot.journal.signer.toLowerCase() !== input.journal.signer.toLowerCase()
    || canonicalJson(snapshot.journal.requirements) !== canonicalJson(input.journal.requirements)
    || Object.entries(input.journal.payment).some(([key, value]) => canonicalJson((snapshot.journal.payment as unknown as Record<string, unknown>)[key]) !== canonicalJson(value))
    || canonicalJson(snapshot.original) !== canonicalJson(prepareBrowserSigningOriginal(snapshot.journal, input.queryNamespace))) refuse();
  return { status: "admitted", journal: snapshot.journal, original: snapshot.original };
}
export async function admitSupabaseBrowserSourceSigningOriginal(sb: SupabaseClient, input: BrowserSourceOriginalAdmission, authority: BrowserOriginalSourceAuthority): Promise<BrowserOriginalAdmissionResult> {
  input = JSON.parse(canonicalJson(input)) as BrowserSourceOriginalAdmission;
  function freeze(value: object): void { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); Object.freeze(value); }
  freeze(input);
  if (input.protocol !== "durable-v3" || input.journal.kind !== "fetch") refuse();
  const replay = await sb.rpc("browser_signing_replay_source_original", { p_input: input });
  if (replay.error) refuse(); const prior = object(replay.data);
  let result: Record<string, unknown>;
  if (prior.status === "admitted") result = prior;
  else if (prior.status === "inactive") return { status: "inactive" };
  else if (prior.status === "refused") return { status: "refused" };
  else if (prior.status === "missing") {
    const token = await authority.resolve(input);
    const prepared = prepareBrowserSourceSigningAdmission(input, token);
    const args = { p_input: prepared.input, p_journal: prepared.journal, p_original: prepared.original, p_admission_deadline_ms: prepared.admissionDeadlineMs };
    assertVerifiedBrowserOriginalSourceContextCurrent(token, input);
    const admission = await sb.rpc("browser_signing_admit_source_original", args);
    if (admission.error) refuse(); result = object(admission.data);
  } else refuse();
  if (result.status === "inactive" || result.status === "refused") return { status: result.status };
  if (result.status !== "admitted") refuse();
  const retained = JSON.parse(canonicalJson(result.snapshot)) as BrowserSigningSnapshot;
  const snapshot = await validateBrowserSigningSnapshot(retained, retained.namespace.owner);
  if (snapshot.original.protocol !== "durable-v3" || snapshot.query.namespace !== input.queryNamespace || snapshot.query.queryId !== input.queryId
    || snapshot.journal.sessionId !== input.journal.sessionId || snapshot.journal.requestId !== input.journal.requestId
    || snapshot.journal.grantEpoch !== input.journal.grantEpoch || snapshot.journal.signer.toLowerCase() !== input.journal.signer.toLowerCase()
    || canonicalJson(snapshot.journal.requirements) !== canonicalJson(input.journal.requirements)
    || Object.entries(input.journal.payment).some(([key, value]) => canonicalJson((snapshot.journal.payment as unknown as Record<string, unknown>)[key]) !== canonicalJson(value))
    || snapshot.original.sourceContext.source.sourceId !== input.source.sourceId || snapshot.original.sourceContext.item.itemId !== input.source.itemId
    || snapshot.original.sourceContext.item.contentVersion !== input.source.contentVersion
    || (snapshot.original.sourceContext.price.mode === "creator-offer" ? snapshot.original.sourceContext.price.offer.id : null) !== input.source.offerId) refuse();
  return { status: "admitted", journal: snapshot.journal, original: snapshot.original };
}
export async function signSupabaseBrowserSigningOriginal(sb: SupabaseClient, sessionId: string, requestId: string, header: string): Promise<boolean> {
  if (!sessionId || !requestId) refuse();
  const { data, error } = await sb.rpc("browser_signing_header_original", { p_session_id: sessionId, p_request_id: requestId });
  if (error) refuse(); if (data === null) return false;
  const metadata = await verifyBrowserSigningHeader(object(data) as unknown as BrowserSigningOriginal, header);
  const signed = await sb.rpc("browser_signing_record_signature", { p_session_id: sessionId, p_request_id: requestId, p_metadata: metadata });
  if (signed.error || typeof signed.data !== "boolean") refuse(); return signed.data;
}
export async function readSupabaseBrowserSigningSnapshot(sb: SupabaseClient, owner: string, sessionId: string, requestId: string): Promise<BrowserSigningSnapshot | null> {
  if (typeof owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(owner) || !sessionId || !requestId) refuse();
  const { data, error } = await sb.rpc("browser_signing_snapshot", { p_owner: owner.toLowerCase(), p_session_id: sessionId, p_request_id: requestId });
  if (error) refuse(); if (data === null) return null;
  return validateBrowserSigningSnapshot(object(data) as unknown as BrowserSigningSnapshot, owner);
}
/** Observation only: recovered signer identity does not admit or sign a leg. */
export async function readExposedSupabaseBrowserSigningSnapshotForSigner(sb: SupabaseClient, recoveredSigner: string, sessionId: string, requestId: string): Promise<BrowserSigningSnapshot | null> {
  if (typeof recoveredSigner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(recoveredSigner) || !sessionId || !requestId) refuse();
  const signer = recoveredSigner.toLowerCase();
  const { data, error } = await sb.rpc("browser_signing_exposed_snapshot_for_signer", { p_signer: signer, p_session_id: sessionId, p_request_id: requestId });
  if (error) refuse(); if (data === null) return null;
  const retained = JSON.parse(canonicalJson(object(data))) as BrowserSigningSnapshot;
  const snapshot = await validateBrowserSigningSnapshot(retained, retained.namespace.owner);
  if (snapshot.namespace.signer !== signer || snapshot.journal.signer.toLowerCase() !== signer
    || snapshot.original.authorization.from !== signer || snapshot.journal.sessionId !== sessionId || snapshot.journal.requestId !== requestId
    || !["exposed", "signed", "submission_attempted", "settled", "failed"].includes(snapshot.journal.phase)) refuse();
  return snapshot;
}
