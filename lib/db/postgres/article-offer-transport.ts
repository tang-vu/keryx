import type { KeryxDB } from '../keryx-db';
import { APPLICATION_READ_OPERATIONS } from './application-read-calls';
import type { PostgresDomainChannel } from './domain-channel';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import { PostgresStorageUnavailable } from './connection';
import { captureArticleOfferSet,captureArticleOfferKey,captureArticleOfferList,readArticleOffer } from './article-offer-packet';

/** Root must register these two literal entries in its closed channel. This
 * leaf never adds a SQL/function selector or installed-facade proof. */
export const ARTICLE_OFFER_CALLS=Object.freeze({
 articleOfferSet:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'set_article_offer',$3::jsonb) AS result",args:1,write:true,bytes:0},
 articleOfferDelete:{sql:"SELECT public.storage_application_operational_write($1::jsonb,$2::text,'delete_article_offer',$3::jsonb) AS result",args:1,write:true,bytes:0},
} as const);
export type PostgresArticleOfferPort=Pick<KeryxDB,'setArticleOffer'|'deleteArticleOffer'|'getArticleOffer'|'listArticleOffers'>;
export function composePostgresArticleOffers(channel:PostgresDomainChannel,readOnly:boolean):PostgresArticleOfferPort{
 if(arguments.length!==2||typeof readOnly!=='boolean')throw new PostgresStorageUnavailable();
 const live=()=>{if(channel.closed)throw new PostgresStorageUnavailable();};
 const write=()=>{live();if(readOnly)throw new PostgresStorageUnavailable();};
 const submit=async(operation:keyof typeof ARTICLE_OFFER_CALLS,payload:string)=>{
  live();
  try{
   const result=await channel.call(operation as Parameters<PostgresDomainChannel['call']>[0],[payload]);
   if(channel.closed||result!==null)throw new PostgresDomainWriteOutcomeUnknown();
  }catch{throw new PostgresDomainWriteOutcomeUnknown();}
 };
 return Object.freeze({
  async setArticleOffer(input){write();const payload=captureArticleOfferSet(input);await submit('articleOfferSet',payload);},
  async deleteArticleOffer(sourceId,itemId){write();const payload=captureArticleOfferKey(sourceId,itemId);await submit('articleOfferDelete',payload);},
  async getArticleOffer(sourceId,itemId){live();const payload=captureArticleOfferKey(sourceId,itemId),value=await channel.call(APPLICATION_READ_OPERATIONS.get_article_offer,[payload]);live();return value===null?null:readArticleOffer(value);},
  async listArticleOffers(sourceId){live();const payload=captureArticleOfferList(sourceId),value=await channel.call(APPLICATION_READ_OPERATIONS.list_article_offers,[payload]);live();if(!Array.isArray(value)||value.length>1000)throw new PostgresStorageUnavailable();return value.map(readArticleOffer);},
 } satisfies PostgresArticleOfferPort);
}
