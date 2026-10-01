import { createHash } from "node:crypto";
import { verifyMessage, type Hex } from "viem";
import { canonicalJson } from "../canonical-json";
import { config } from "../config";
import { getRegistrySource } from "../registry/registry-client";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import { recoverArticleContentManifestSigner, articleContentManifestId } from "../sources/article-content-manifest";
import type { Source, SourceItem } from "../types";
import { paperDeclarationMessage, paperDecisionMessage, signedPaperDeclarationSchema,
  signedPaperDecisionSchema, type SignedPaperDeclaration, type SignedPaperDecision, type PaperDeclaration, type PaperState } from "./rights-protocol";

export function paperArtifactId(value: unknown): string {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
export async function verifyPaperDeclaration(value: SignedPaperDeclaration): Promise<SignedPaperDeclaration> {
  const parsed = signedPaperDeclarationSchema.parse(value);
  if (!await verifyMessage({ address: parsed.declaration.creator as Hex,
    message: paperDeclarationMessage(parsed.declaration), signature: parsed.signature as Hex }))
    throw new Error("Invalid rights declaration signature");
  return parsed;
}
export function paperReviewers(): string[] {
  const raw = process.env.KERYX_SCHOLARLY_REVIEWERS ?? "";
  const reviewers = raw.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!reviewers.length || reviewers.some(v => !/^0x[0-9a-f]{40}$/.test(v)))
    throw new Error("Scholarly reviewer allowlist is not configured");
  return reviewers;
}
export async function verifyPaperDecision(value: SignedPaperDecision, creator: string): Promise<SignedPaperDecision> {
  const parsed = signedPaperDecisionSchema.parse(value), d = parsed.decision;
  if (!paperReviewers().includes(d.reviewer) || d.reviewer === creator.toLowerCase())
    throw new Error("An independently authorized reviewer is required");
  if (Date.parse(d.reviewedAt) > Date.now() + 60_000 || Date.parse(d.reviewedAt) < Date.now() - 24 * 3600_000)
    throw new Error("Review artifact must be applied within 24 hours of signing");
  if (!await verifyMessage({ address: d.reviewer as Hex, message: paperDecisionMessage(d), signature: parsed.signature as Hex }))
    throw new Error("Invalid reviewer signature");
  return parsed;
}
export async function verifyRetainedPaperState(state: PaperState): Promise<void> {
  await verifyPaperDeclaration(state.submission);
  const review = state.review;
  if (!review || paperArtifactId(state.submission) !== state.declarationId || paperArtifactId(review) !== state.decisionId
    || review.decision.declarationId !== state.declarationId || !paperReviewers().includes(review.decision.reviewer)
    || review.decision.reviewer === state.submission.declaration.creator
    || !await verifyMessage({ address: review.decision.reviewer as Hex,
      message: paperDecisionMessage(review.decision), signature: review.signature as Hex }))
    throw new Error("Retained scholarly rights are not independently signed authority");
}
export function assertPaperVersion(d: PaperDeclaration, source: Source, items: SourceItem[]): void {
  const item = items[0];
  if (items.length !== 1 || !item || item.sourceId !== source.id || item.id !== d.itemId
    || item.link !== d.canonicalUrl || sourceItemContentVersion(item) !== d.contentVersion
    || item.deliveryKind !== "full_text" || !item.manifest
    || item.manifest.id !== d.manifestId || item.manifest.bodyHash.toLowerCase() !== d.bodyHash
    || item.manifest.plaintextBytes !== d.plaintextBytes || item.manifest.signer.toLowerCase() !== d.creator
    || item.bodyHash?.toLowerCase() !== d.bodyHash || item.plaintextBytes !== d.plaintextBytes)
    throw new Error("Dedicated scholarly source must contain exactly the declared signed full-text version");
}
export async function assertPaperManifest(d: PaperDeclaration, item: SourceItem): Promise<void> {
  const manifest = item.manifest;
  if (!manifest || manifest.sourceId !== d.sourceId || manifest.itemId !== d.itemId || manifest.canonicalUrl !== d.canonicalUrl
    || manifest.deliveryKind !== "full_text" || articleContentManifestId(manifest.signature as Hex).toLowerCase() !== d.manifestId
    || (await recoverArticleContentManifestSigner(manifest)).toLowerCase() !== d.creator)
    throw new Error("Exact manuscript manifest signature is unavailable");
}
export async function assertPaperRegistry(d: PaperDeclaration, source: Source): Promise<void> {
  if (config.networkId !== "eip155:5042002" || config.usdcAddress.toLowerCase() !== "0x3600000000000000000000000000000000000000"
    || d.deploymentOrigin !== new URL(config.baseUrl).origin || !source.onchainId || source.onchainId.toLowerCase() !== d.onchainId
    || !config.registryReadAddress || config.registryReadAddress.toLowerCase() !== d.registry
    || source.id !== d.sourceId || source.active === false || source.verified !== true)
    throw new Error("Active verified Arc-testnet registry enrollment is required");
  // Direct uncached read: no legacy unregistered/unavailable/stale fallback for scholarly rights.
  const record = await getRegistrySource(source.onchainId as Hex, { timeoutMs: 4000 });
  if (!record || !record.active || record.creator.toLowerCase() !== d.creator
    || record.payoutWallet.toLowerCase() !== d.recipient || record.fetchPriceUsdc6.toString() !== d.priceMicros
    || record.authors.length > 1 || record.authors.some(a => a.wallet.toLowerCase() !== d.recipient || a.basisPoints !== 10000)
    || source.walletAddress.toLowerCase() !== d.recipient
    || source.authors.length > 1 || source.authors.some(a => a.walletAddress.toLowerCase() !== d.recipient)
    || Math.round(source.fetchPrice * 1e6).toString() !== d.priceMicros)
    throw new Error("Fresh registry payment policy differs from the reviewed single recipient");
}
export function assertPaperDates(d: PaperDeclaration, now = Date.now()): void {
  if (now < Date.parse(d.effectiveAt) || now < Date.parse(d.embargoUntil) || now >= Date.parse(d.expiresAt))
    throw new Error("Scholarly distribution permission is not currently effective");
}
