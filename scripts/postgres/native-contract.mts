/** Native digest codec for the independently generated PostgreSQL JSONB wire.
 * Keep the existing normalized descriptor validator/inventory intact. Native SQL
 * binds its stored metadata to SHA256(jsonb::text), rather than a JS serializer. */
import { createHash } from 'node:crypto';
import { exportPostgres17SchemaContract } from '../helpers/enrolled-postgres-schema-contract.mts';
export const NATIVE_CATALOG_DIGEST_FORMAT='keryx-postgres17-jsonb-text-sha256-v1';
export function exportNativePostgresSchemaContract(wire:string){
 if(typeof wire!=='string'||!wire||Buffer.byteLength(wire)>8388608)throw new Error('Native SOURCE descriptor wire refused');
 const normalized=exportPostgres17SchemaContract(JSON.parse(wire));
 return Object.freeze({...normalized,normalizedSha256:normalized.sha256,sha256:createHash('sha256').update(wire).digest('hex'),digestFormat:NATIVE_CATALOG_DIGEST_FORMAT});
}
