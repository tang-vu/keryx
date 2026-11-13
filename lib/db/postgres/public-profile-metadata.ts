/** Private, original-bound inputs for the existing public-profile projection.
 * JSON remains TEXT: escaped NUL and lone surrogates never enter PostgreSQL jsonb.
 * Derivation itself grants neither publication nor ownership authority. */
import { validatePrivacyRun } from '../../run-privacy/contracts';
import { parseRunProvenance } from '../../research/run-provenance';
import { parseRunUsage } from '../../research/usage-provenance';
import { publicRun, publicCitationUrl, type PublicRunSource } from '../../profiles/public-profile-projection';

export function publicProfileOriginalMetadata(value: unknown, id: string, createdAt: string) {
 const raw=value!==null&&typeof value==='object'?value as Record<string,unknown>:{};
 // These literal comparisons mirror json_extract(...)=... in the SQLite ledger.
 // They remain qualified even when an original has no publishable run shape.
 const flags={paymentOffline:raw.paymentMode==='offline',fundingOffline:raw.fundingOwner==='offline',fundingTreasury:raw.fundingOwner==='treasury'};
 let profileFields:string|null=null;
 try {
  const run=validatePrivacyRun(value,id);
  if(run.createdAt!==createdAt)throw Error('Original date mismatch');
  const source:PublicRunSource={id:run.id,question:run.question,createdAt:run.createdAt,
   citations:run.citations.map(c=>({marker:c.marker,sourceName:c.sourceName,...(publicCitationUrl(c.itemUrl)?{itemUrl:publicCitationUrl(c.itemUrl)}:{})})),
   ...(parseRunProvenance(run.provenance)?{provenance:parseRunProvenance(run.provenance)!}:{}),
   ...(parseRunUsage(run.usage)?{usage:parseRunUsage(run.usage)!}:{}),
   ...(run.paymentMode==='offline'?{paymentMode:'offline' as const}:{}),
   ...(run.fundingOwner==='offline'||run.fundingOwner==='treasury'||run.fundingOwner==='browser'?{fundingOwner:run.fundingOwner}:{}),
   ...(run.askerFunded===true?{askerFunded:true}:{})};
  // Both ownership branches use exactly the existing closed, bounded validator.
  publicRun(source,false,[]);publicRun(source,true,[]);
  const wire=JSON.stringify(source);
  if(Buffer.byteLength(wire)<=262144)profileFields=wire;
 }catch{/* Unsupported public shape stays private; original bytes are retained. */}
 return Object.freeze({profileFields,...flags});
}
