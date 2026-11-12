import type { DatabaseSync } from 'node:sqlite';
import { topicWatchProjection } from '../../lib/db/postgres/watch-packet';
/** Held SOURCE intake only; never a runtime enrollment or writer capability. */
export function sqliteWatchProjection(db:DatabaseSync,wallet:string,id:string){
 const row=db.prepare("SELECT wallet,id,revision,CASE WHEN typeof(state)='text' AND length(CAST(state AS BLOB))<=262144 THEN state END state,CASE WHEN length(CAST(state AS BLOB))<=262144 THEN lower(hex(CAST(state AS BLOB))) END state_hex FROM topic_watches WHERE wallet=? AND id=?").get(wallet,id);
 if(!row||typeof row.state!=='string'||Buffer.from(row.state).toString('hex')!==row.state_hex)throw new Error('Watch SOURCE original unavailable');const p=topicWatchProjection(row.state);
 if(p.owner!==row.wallet||p.id!==row.id||p.revision!==row.revision)throw new Error('Watch SOURCE binding refused');return p;
}
export function heldWatchProjectionSql(p:ReturnType<typeof topicWatchProjection>){
 if(!/^0x[a-f0-9]{40}$/.test(p.owner)||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id)||!/^[a-f0-9]{64}$/.test(p.originalSha256))throw new Error('Watch SOURCE projection refused');
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 return `INSERT INTO keryx_storage.topic_watch_projection(wallet,id,original_sha256,metadata) VALUES(${q(p.owner)},${q(p.id)},${q(p.originalSha256)},${q(JSON.stringify(p))}::jsonb) ON CONFLICT(wallet,id) DO UPDATE SET original_sha256=excluded.original_sha256,metadata=excluded.metadata;`;
}
