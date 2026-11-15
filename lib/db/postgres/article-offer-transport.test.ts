import { expect,it,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ArticleOffer } from '../../types';
import { APPLICATION_READ_OPERATIONS } from './application-read-calls';
import { type PostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import { ARTICLE_OFFER_CALLS,composePostgresArticleOffers } from './article-offer-transport';
import { captureArticleOfferSet } from './article-offer-packet';
const offer:ArticleOffer={sourceId:'source',itemId:'item',id:'id',contentVersion:'version',priceUsdc6:0,expiresAt:1,signer:'SIGNER',nonce:'nonce',signature:'\uFEFFsignature',createdAt:'raw clock'};
function fixture(){let closed=false;const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(null),channel:PostgresDomainChannel={call,get closed(){return closed;},async close(){closed=true;}};return {call,channel,port:composePostgresArticleOffers(channel,false)};}
it('uses two fixed literal writes, exact synchronous capture and existing selected reads only',async()=>{
 const f=fixture(),input={...offer},expected=captureArticleOfferSet(input),pending=f.port.setArticleOffer(input);input.signature='changed';await pending;
 expect(f.call.mock.calls[0]).toEqual(['articleOfferSet',[expected]]);
 await f.port.deleteArticleOffer('source','item');expect(f.call.mock.calls[1]).toEqual(['articleOfferDelete',['{"p_source_id":"source","p_item_id":"item"}']]);
 f.call.mockResolvedValue(JSON.parse(expected).p_row);expect(await f.port.getArticleOffer('source','item')).toEqual(offer);
 expect(f.call.mock.calls[2][0]).toBe(APPLICATION_READ_OPERATIONS.get_article_offer);
 f.call.mockResolvedValue([JSON.parse(expected).p_row]);expect(await f.port.listArticleOffers('')).toEqual([offer]);expect(f.call.mock.calls[3]).toEqual([APPLICATION_READ_OPERATIONS.list_article_offers,['{"p_source_id":null}']]);
 expect(Object.values(ARTICLE_OFFER_CALLS).map(v=>[v.args,v.write,v.bytes])).toEqual([[1,true,0],[1,true,0]]);
 for(const [name,opcode] of [['articleOfferSet','set_article_offer'],['articleOfferDelete','delete_article_offer']] as const)expect(ARTICLE_OFFER_CALLS[name].sql).toBe(`SELECT public.storage_application_operational_write($1::jsonb,$2::text,'${opcode}',$3::jsonb) AS result`);
 expect(Reflect.get(f.port,'assertPostgresRuntimeIdentity')).toBeUndefined();
});
it('refuses readonly or closed writes before caller getters, with no legacy fallback',async()=>{
 const f=fixture(),getter=vi.fn(()=>{throw Error('must not read');}),input=new Proxy(offer,{get:getter});
 await expect(composePostgresArticleOffers(f.channel,true).setArticleOffer(input)).rejects.toThrow();expect(getter).not.toHaveBeenCalled();
 await f.channel.close();await expect(f.port.setArticleOffer(input)).rejects.toThrow();expect(getter).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
});
it('reports unknown after a submitted write closes or loses acknowledgement and never retries',async()=>{
 for(const result of ['closed','lost','shape'] as const){const f=fixture();f.call.mockImplementation(async()=>{if(result==='lost')throw Error('unknown');if(result==='closed')await f.channel.close();return result==='shape'?{}:null;});await expect(f.port.setArticleOffer(offer)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(f.call).toHaveBeenCalledTimes(1);}
});
it('refuses post-await reads after close and rejects malformed or bounded results',async()=>{
 const f=fixture();f.call.mockImplementation(async()=>{await f.channel.close();return JSON.parse(captureArticleOfferSet(offer)).p_row;});await expect(f.port.getArticleOffer('s','i')).rejects.toThrow();
 const other=fixture();other.call.mockResolvedValue({});await expect(other.port.listArticleOffers()).rejects.toThrow();other.call.mockResolvedValue(Array(1001).fill({}));await expect(other.port.listArticleOffers()).rejects.toThrow();
});
it('aligns only empty originals, keeps ten-cell readers and adds no SQL function',()=>{
 const sql=readFileSync(new URL('../../../ops/keryx-postgres/article-offers.sql',import.meta.url),'utf8');
 expect(sql.indexOf('IF EXISTS(SELECT 1 FROM public.article_offers)')).toBeLessThan(sql.indexOf('ALTER TABLE'));
 expect(sql).toContain('TYPE text COLLATE "C" USING NULL::text');expect(sql).not.toMatch(/created_at::text|to_char|CASCADE|CREATE FUNCTION/);
 expect(sql).toContain('source_order bigint NOT NULL UNIQUE');expect(sql).toContain("to_jsonb(r)-'source_order'");
 expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()');
 expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
});
