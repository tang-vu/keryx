import type { ArticleOffer } from '../../types';

/** A bounded protocol hold, never a changed or absent signed original. */
export class ArticleOfferRepresentabilityHold extends Error {
 constructor(readonly reason:'text-nul'|'text-surrogate'|'integer-range'|'wire-bound'){
  super('Native article offer representation unavailable');
 }
}
const fail=():never=>{throw Error('Native article offer packet refused');};
const text=(value:unknown):string=>{
 if(typeof value!=='string')return fail();
 if(value.includes('\0'))throw new ArticleOfferRepresentabilityHold('text-nul');
 if(Buffer.from(value,'utf8').toString('utf8')!==value)throw new ArticleOfferRepresentabilityHold('text-surrogate');
 if(Buffer.byteLength(value)>8192)throw new ArticleOfferRepresentabilityHold('wire-bound');
 return value;
};
const integer=(value:unknown):number=>{
 if(typeof value!=='number'||!Number.isSafeInteger(value))throw new ArticleOfferRepresentabilityHold('integer-range');
 return value;
};
const wire=(value:unknown)=>{const result=JSON.stringify(value);if(Buffer.byteLength(result)>65536)throw new ArticleOfferRepresentabilityHold('wire-bound');return result;};

/** Read the same ten cells once, synchronously, before any transport await.
 * Storage neither verifies the signature nor decides registry/payout authority. */
export function captureArticleOfferSet(input:ArticleOffer):string{
 const source_id=input.sourceId,item_id=input.itemId,id=input.id,content_version=input.contentVersion,
  price_usdc6=input.priceUsdc6,expires_at=input.expiresAt,signer=input.signer,nonce=input.nonce,signature=input.signature,created_at=input.createdAt;
 return wire({p_row:{source_id:text(source_id),item_id:text(item_id),id:text(id),content_version:text(content_version),
  price_usdc6:integer(price_usdc6),expires_at:integer(expires_at),signer:text(signer),nonce:text(nonce),signature:text(signature),created_at:text(created_at)}});
}
export function captureArticleOfferKey(sourceId:string,itemId:string){return wire({p_source_id:text(sourceId),p_item_id:text(itemId)});}
export function captureArticleOfferList(sourceId?:string){return wire({p_source_id:sourceId===undefined||sourceId===''?null:text(sourceId)});}
const keys=['source_id','item_id','id','content_version','price_usdc6','expires_at','signer','nonce','signature','created_at'];
export function readArticleOffer(value:unknown):ArticleOffer{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))return fail();
 const row=value as Record<string,unknown>;
 return {sourceId:text(row.source_id),itemId:text(row.item_id),id:text(row.id),contentVersion:text(row.content_version),
  priceUsdc6:integer(row.price_usdc6),expiresAt:integer(row.expires_at),signer:text(row.signer),nonce:text(row.nonce),signature:text(row.signature),createdAt:text(row.created_at)};
}
