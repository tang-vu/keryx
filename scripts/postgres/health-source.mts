import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeReviewsSource } from './reviews-source.mts';
/** SOURCE-owned private metric composition. The outer fixed health operation
 * already holds current identity/catalog/control/data admission for all inputs. */
export function nativeHealthSource(){
 const base=nativeReviewsSource(),dashboard=readFileSync(new URL('../../ops/keryx-postgres/dashboard-metrics.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const found=[...dashboard.matchAll(/CREATE FUNCTION public\.storage_dashboard_metrics\(expected jsonb,digest text\) RETURNS jsonb\n[\s\S]*?\nEND;\$\$;/g)];if(found.length!==1)throw new Error('Native dashboard SOURCE shape changed');
 const before="PERFORM keryx_storage.require_operation(expected,digest,'dashboard_metrics');";if(found[0][0].split(before).length!==2)throw new Error('Native dashboard admission SOURCE changed');
 const metrics=found[0][0].replace('public.storage_dashboard_metrics(expected jsonb,digest text)','keryx_storage.health_metrics(expected jsonb)').replace(before,()=>"PERFORM keryx_storage.read_operation(expected,'dashboard_metrics');");
 const health=readFileSync(new URL('../../ops/keryx-postgres/health.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');if(Buffer.byteLength(health)>16384)throw new Error('Native health SOURCE bound');
 const sql=base.sql+'\nSET ROLE keryx_owner;\n'+metrics+'\nRESET ROLE;\n'+health;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Read-only health observation SOURCE; complete writer, remaining domains and live migration/load/cutover remain closed.'});
}
