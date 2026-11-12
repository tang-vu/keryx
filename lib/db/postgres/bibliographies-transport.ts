import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { paperReferencesBibtex } from '../../papers/reference-export';
import { bibliographyIdSchema,bibliographyInputSchema,bibliographyMetadataSchema,bibliographyOwner,bibliographyRevisionSchema,bibliographyTokenSchema,MAX_BIBLIOGRAPHY_CONTENT_BYTES,PrivateBibliographyError,type BibliographyInput,type PrivateBibliographiesStore } from '../../bibliographies/private-bibliography';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const unavailable=()=>new PrivateBibliographyError('bibliography_unavailable');
const tokenHash=(input:string)=>createHash('sha256').update('keryx-private-bib-v1:'+bibliographyTokenSchema.parse(input)).digest('hex');
function snapshot(raw:BibliographyInput){const input=bibliographyInputSchema.parse(raw),output=paperReferencesBibtex(input.papers);if(Buffer.byteLength(output.content)>MAX_BIBLIOGRAPHY_CONTENT_BYTES)throw new PrivateBibliographyError('bibliography_limit');return {title:input.title,content:output.content,count:output.count};}
function text(value:string){if(value.includes('\0')||new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(value))!==value)throw unavailable();return value;}
export function composePostgresBibliographies(channel:PostgresDomainChannel,readOnly:boolean):PrivateBibliographiesStore{
 if(typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 const read=async(op:'bibliographyList'|'bibliographyRead',args:string[])=>{try{live();const value=await channel.call(op,args);live();return value;}catch{throw unavailable();}};
 const mutation=async(op:'bibliographyCreate'|'bibliographyReplace'|'bibliographyRevoke',owner:string,input:Record<string,unknown>)=>{
  const value=await channel.call(op,[owner,JSON.stringify(input)]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
  const refusal=z.object({error:z.enum(['bibliography_unavailable','bibliography_not_found','bibliography_conflict','bibliography_limit'])}).strict().safeParse(value);if(refusal.success)throw new PrivateBibliographyError(refusal.data.error);return value;
 };
 const metadata=(raw:unknown,id:string,revision:number)=>{try{const p=z.object({bibliography:bibliographyMetadataSchema}).strict().parse(raw).bibliography;if(p.id!==id||p.revision!==revision)throw new Error();return p;}catch{throw new PostgresDomainWriteOutcomeUnknown();}};
 return Object.freeze({
  async list(owner){live();const wallet=bibliographyOwner(owner);try{return z.object({items:z.array(bibliographyMetadataSchema).max(20)}).strict().parse(await read('bibliographyList',[wallet])).items;}catch{throw unavailable();}},
  async read(token){live();const digest=tokenHash(token);try{const p=z.object({item:z.object({contentHex:z.string().max(1048576)}).strict().nullable()}).strict().parse(await read('bibliographyRead',[digest]));if(!p.item)return null;const hex=p.item.contentHex;if(hex.length%2||/[^a-f0-9]/.test(hex))throw new Error();return {content:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(hex,'hex'))};}catch{throw unavailable();}},
  async create(owner,raw){writer();const wallet=bibliographyOwner(owner),input=snapshot(raw),id=randomUUID(),token=randomBytes(32).toString('hex'),now=new Date().toISOString();const value=await mutation('bibliographyCreate',wallet,{id,tokenHash:tokenHash(token),title:text(input.title),content:text(input.content),count:input.count,now});return {bibliography:metadata(value,id,1),token};},
  async replace(owner,rawId,raw,rawRevision){writer();const wallet=bibliographyOwner(owner),id=bibliographyIdSchema.parse(rawId),revision=bibliographyRevisionSchema.parse(rawRevision),input=snapshot(raw),now=new Date().toISOString();const value=await mutation('bibliographyReplace',wallet,{id,revision,title:text(input.title),content:text(input.content),count:input.count,now});return metadata(value,id,revision+1);},
  async revoke(owner,rawId,rawRevision){writer();const wallet=bibliographyOwner(owner),id=bibliographyIdSchema.parse(rawId),revision=bibliographyRevisionSchema.parse(rawRevision);const value=await mutation('bibliographyRevoke',wallet,{id,revision});try{z.object({revoked:z.literal(true)}).strict().parse(value);}catch{throw new PostgresDomainWriteOutcomeUnknown();}},
 } satisfies PrivateBibliographiesStore);
}
