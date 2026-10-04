import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { fetchPublicDocument } from "../net/public-fetch";
import { sourceClaimProofSchema, sourceClaimProof, sourceClaimProofUrl, type SourceClaimChallenge } from "./public-source-claim";
import { SourceClaimError } from "../db/public-source-claims";
import Parser from "rss-parser";

export function sourceClaimProofToken(challenge: SourceClaimChallenge): string {
  return `keryx-source-claim-v1:${challenge.nonce}:${createHash("sha256").update(canonicalJson(sourceClaimProof(challenge))).digest("hex")}`;
}

/** Origin-root proof establishes publishing control; article/comment content is never proof. */
export async function verifyPublicSourceClaimProof(challenge: SourceClaimChallenge): Promise<string> {
  const rss = challenge.proofMethod === "rss-channel";
  const proofUrl = sourceClaimProofUrl(challenge.canonicalUrl, challenge.rssUrl, challenge.proofMethod);
  let value;
  try {
    value = await fetchPublicDocument(proofUrl, { timeoutMs: 10_000, maxBytes: rss ? 500_000 : 16_384, maxHops: 0,
      httpsOnly: true, allowedContentTypes: rss ? ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "text/plain"] : ["application/json", "text/plain"] });
  } catch { throw new SourceClaimError("The dedicated HTTPS claim proof could not be read. Publish the exact proof without redirects and retry.", 502, "proof_unavailable"); }
  if (value.finalUrl !== proofUrl) throw new SourceClaimError("Claim proof redirects are not accepted", 400, "proof_redirect");
  if (rss) {
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(value.text)) throw new SourceClaimError("Claim feeds must not contain document types or entity declarations", 400, "proof_mismatch");
    let feed;
    try { feed = await new Parser<{ subtitle?: string }>({ customFields: { feed: ["subtitle"] } }).parseString(value.text); }
    catch { throw new SourceClaimError("The pinned feed could not be parsed as RSS or Atom", 400, "proof_mismatch"); }
    const token = sourceClaimProofToken(challenge);
    // rss-parser projects publisher metadata separately; never inspect items, author, links or comments.
    if (![feed.title, feed.description, feed.subtitle].some(field => typeof field === "string" && field.split(/\s+/u).includes(token)))
      throw new SourceClaimError("Place the exact claim token in publisher-controlled channel title/description or Atom subtitle; post and comment tokens do not establish ownership", 409, "proof_mismatch");
    return createHash("sha256").update(token).digest("hex");
  }
  const parsed = sourceClaimProofSchema.safeParse((() => { try { return JSON.parse(value.text); } catch { return null; } })());
  if (!parsed.success || canonicalJson(parsed.data) !== canonicalJson(sourceClaimProof(challenge)))
    throw new SourceClaimError("The dedicated proof does not match this wallet, source and unexpired challenge", 409, "proof_mismatch");
  return createHash("sha256").update(canonicalJson(parsed.data)).digest("hex");
}
