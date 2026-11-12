import { createHash } from 'node:crypto';
import { canonicalJson } from '../../canonical-json';
import { parseTopicWatchState,type TopicWatchState } from '../../research/topic-watches';
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
/** Pure complete-state derivative. Hashes compare the current Node SOURCE
 * semantics without decoding arbitrary original JSON through PostgreSQL JSONB. */
export function topicWatchProjection(original:string){
 if(Buffer.byteLength(original)>262144)throw new Error('Native watch original bound');
 const state=parseTopicWatchState(JSON.parse(original));
 return Object.freeze({originalSha256:createHash('sha256').update(original).digest('hex'),owner:state.key.ownerWallet,id:state.key.watchId,revision:state.revision,
  status:state.status,createdAtMs:state.createdAtMs,nextSlot:state.nextSlot,specDigest:hash(state.spec),incarnation:state.incarnation,
  history:state.history.map(entry=>({digest:hash(entry),pending:entry.kind==='check'&&entry.status==='pending',
   checkKey:entry.kind==='check'?hash([entry.checkId,entry.slot,entry.periodIndex,entry.claimedAtMs,entry.deadlineAtMs]):null})),
  watermark:state.watermark.map(hash)});
}
export function captureTopicWatch(input:TopicWatchState){
 const state=parseTopicWatchState(input),wire=canonicalJson(state);
 return Object.freeze({originalHex:Buffer.from(wire).toString('hex'),projection:topicWatchProjection(wire)});
}
