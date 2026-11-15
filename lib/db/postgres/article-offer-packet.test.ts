import { DatabaseSync } from 'node:sqlite';
import { describe,it,expect } from 'vitest';
import { installMainnetApplicationSchema } from '../mainnet-application-schema';
import { installNativeUserDomainSchema } from '../native-user-domain-schema';
import { SqliteAdapter } from '../sqlite-adapter';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import type { ArticleOffer } from '../../types';
import { ArticleOfferRepresentabilityHold,captureArticleOfferSet,captureArticleOfferKey,captureArticleOfferList,readArticleOffer } from './article-offer-packet';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storageId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'dd'.repeat(32)};
const offer=(patch:Partial<ArticleOffer>={}):ArticleOffer=>({sourceId:'orphan-source',itemId:'z',id:'offer-z',contentVersion:'\uFEFFversion',priceUsdc6:0,expiresAt:-1,signer:'\uFEFFUPPER-signer',nonce:'nonce ',signature:'\uFEFFraw-signature',createdAt:'2026-11-15T01:00:00.123456789+01:00',...patch});

it('captures each Source cell once in binding order and preserves raw signed strings',()=>{
 const input=offer(),reads:string[]=[],expected=JSON.parse(captureArticleOfferSet(input));
 const proxy=new Proxy(input,{get(target,key,receiver){reads.push(String(key));return Reflect.get(target,key,receiver);}});
 expect(JSON.parse(captureArticleOfferSet(proxy))).toEqual(expected);
 expect(reads).toEqual(['sourceId','itemId','id','contentVersion','priceUsdc6','expiresAt','signer','nonce','signature','createdAt']);
 expect(readArticleOffer(expected.p_row)).toEqual(input);
 expect(JSON.parse(captureArticleOfferList(''))).toEqual({p_source_id:null});
 expect(JSON.parse(captureArticleOfferKey('\uFEFFsource','item'))).toEqual({p_source_id:'\uFEFFsource',p_item_id:'item'});
});
describe('explicit representability holds do not rewrite or manufacture an absent original',()=>{
 it.each(['\0','before\0after','\uD800','\uDFFF'])('holds unsupported text %j',value=>{
  const input=offer({signature:value});expect(()=>captureArticleOfferSet(input)).toThrow(ArticleOfferRepresentabilityHold);expect(input.signature).toBe(value);
  expect(()=>captureArticleOfferKey(value,'x')).toThrow(ArticleOfferRepresentabilityHold);
 });
 it.each([NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1])('holds unsupported integer %s',value=>expect(()=>captureArticleOfferSet(offer({priceUsdc6:value}))).toThrow(ArticleOfferRepresentabilityHold));
 it('bounds individual strings, complete packet and exact returned cells',()=>{
  expect(()=>captureArticleOfferSet(offer({signature:'x'.repeat(8193)}))).toThrow(ArticleOfferRepresentabilityHold);
  expect(()=>captureArticleOfferSet(offer({sourceId:'x'.repeat(8192),itemId:'x'.repeat(8192),id:'x'.repeat(8192),contentVersion:'x'.repeat(8192),signer:'x'.repeat(8192),nonce:'x'.repeat(8192),signature:'x'.repeat(8192),createdAt:'x'.repeat(8192)}))).toThrow(ArticleOfferRepresentabilityHold);
  expect(()=>readArticleOffer({...JSON.parse(captureArticleOfferSet(offer())).p_row,source_order:1})).toThrow();
 });
});

it('matches actual Source ten-cell UPSERT/delete, raw TEXT ordering and SQLite bindings without adding FK authority',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON;BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');
  // Genuine SOURCE core only. This fixture does not issue installed facade proof.
  const source=SqliteAdapter.assembleConnectionCore(db,identity,()=>{});
  const first=offer();await source.setArticleOffer(first);
  expect(readArticleOffer(JSON.parse(captureArticleOfferSet(first)).p_row)).toEqual(await source.getArticleOffer(first.sourceId,first.itemId));
  const changed=offer({id:'new-id',priceUsdc6:-9,expiresAt:42,nonce:'changed',signature:'sig2',createdAt:'raw not a timestamp'});
  const before=db.prepare('SELECT rowid FROM article_offers').get()!.rowid;await source.setArticleOffer(changed);
  expect(db.prepare('SELECT rowid FROM article_offers').get()!.rowid).toBe(before);
  expect(await source.getArticleOffer(first.sourceId,first.itemId)).toEqual(changed);
  await expect(source.setArticleOffer(offer({itemId:'other',id:changed.id}))).rejects.toThrow();
  expect(await source.listArticleOffers()).toEqual([changed]);
  await source.deleteArticleOffer('missing','missing');await source.deleteArticleOffer(first.sourceId,first.itemId);expect(await source.getArticleOffer(first.sourceId,first.itemId)).toBeNull();
  const same='2026-11-15T01:00:00.123456789+01:00';
  for(const [itemId,sourceId] of [['z','s'],['a','s'],['b','t'],['m','s']])await source.setArticleOffer(offer({sourceId,itemId,id:sourceId+itemId,createdAt:same}));
  expect((await source.listArticleOffers()).map(r=>r.itemId)).toEqual(['z','a','b','m']);
  expect(await source.listArticleOffers('')).toEqual(await source.listArticleOffers());
  expect((await source.listArticleOffers('s')).map(r=>r.itemId)).toEqual(['a','m','z']);
  // SQLite preserves embedded NUL and repairs an unpaired JS surrogate on bind.
  // The native protocol refuses those classes instead of silently doing either.
  await source.setArticleOffer(offer({id:'nul',itemId:'nul',signature:'a\0b'}));expect((await source.getArticleOffer('orphan-source','nul'))!.signature).toBe('a\0b');
  await source.setArticleOffer(offer({id:'surrogate',itemId:'surrogate',signature:'\uD800'}));expect((await source.getArticleOffer('orphan-source','surrogate'))!.signature).toBe('\uFFFD');
  db.exec('DELETE FROM article_offers');
  const insert=JSON.parse(captureArticleOfferSet(offer({id:'negative',itemId:'negative'}))).p_row;
  db.prepare('INSERT INTO article_offers(rowid,source_id,item_id,id,content_version,price_usdc6,expires_at,signer,nonce,signature,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(-3n,...Object.values(insert) as (string|number)[]);
  await source.setArticleOffer(offer({id:'auto-negative',itemId:'auto-negative'}));expect(db.prepare("SELECT rowid FROM article_offers WHERE id='auto-negative'").get()!.rowid).toBe(-2);
  db.exec("UPDATE article_offers SET rowid=0 WHERE id='negative'");
  await source.setArticleOffer(offer({id:'auto-positive',itemId:'auto-positive'}));expect(db.prepare("SELECT rowid FROM article_offers WHERE id='auto-positive'").get()!.rowid).toBe(1);
  await source.deleteArticleOffer('orphan-source','auto-positive');await source.setArticleOffer(offer({id:'reuse',itemId:'reuse'}));expect(db.prepare("SELECT rowid FROM article_offers WHERE id='reuse'").get()!.rowid).toBe(1);
 }finally{db.close();}
});
