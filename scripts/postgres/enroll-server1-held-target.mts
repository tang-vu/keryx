/** Fixed server1 schema preparation only. No storage enrollment, import,
 * runtime ENV/manifest switch, HBA reload, app startup or custody operation.
 * Default preflight is readonly. Any partial/unknown apply requires manual
 * review; this tool never adopts, retries, drops or repairs an existing target. */
import {createHash,createHmac,pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,fsyncSync,lstatSync,openSync,readSync,readdirSync,realpathSync,writeSync,type Stats} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client,types,type ClientConfig} from 'pg';
import {canonicalJson} from '../../lib/canonical-json';
import {storageIdentityDigest,validateStorageIdentity} from '../../lib/db/storage-identity';
import {exportNativePostgresSchemaContract} from './native-contract.mts';
import {inspectServer1PreparedPostgres,type Server1PreparedPostgres} from './prepare-server1-pg17.mts';

export const SERVER1_HELD=Object.freeze({
 directory:'/root/keryx-migration',receipt:'/root/keryx-migration/postgres17-server1-held-target.json',
 manifest:'/root/.local/share/keryx-mainnet-runtime/production-v2/storage.json',
 application:'/root/.local/share/keryx-mainnet-runtime/production-v2/postgres-app.json',
 reader:'/root/.local/share/keryx-mainnet-runtime/production-v2/postgres-reader.json',
 sourceSql:'/root/keryx-migration/postgres-b0/source.sql',intake:'/root/keryx-migration/postgres-b0/intake.cjs',
 sourceSqlSha256:'cc15c6b020b5b838eef62f7f247bec9943567cbc66dfc6359cddd599d65b848c',
 catalogSha256:'d368c98db910ff072d10d7c2a20ba3b8b2934e4f5f76c0afdd875ebfda07803f',
 socket:'/run/postgresql-keryx',port:5432,sourceDatabase:'keryx_source',targetDatabase:'keryx_mainnet',
});
const PHASES=['operation','roles','create-source','allow-source','create-target','allow-target','schema'] as const;
type Phase=typeof PHASES[number];
type Database='postgres'|'keryx_source'|'keryx_mainnet';
type ApplicationRole='keryx_app'|'keryx_reader';
type Capture=Readonly<{path:string;bytes:Buffer;sha256:string;fingerprint:string}>;
function refuse(stage:string):never{throw Error('server1_held_enrollment_refused:'+stage);}
const sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function rootParents(file:string){
 if(resolve(file)!==file||!file.startsWith('/root/'))refuse('fixed_private_path');
 const bindings:string[]=[];
 for(let p=dirname(file);;p=dirname(p)){
  const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o022)||(p===dirname(file)&&(s.mode&0o077))||realpathSync(p)!==p)refuse('private_parent');bindings.push([p,s.dev,s.ino,s.uid,s.gid,s.mode].join(':'));if(p==='/')break;
 }return bindings.join('|');
}
function signature(s:Stats):string{return [s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink,s.size,s.mtimeMs,s.ctimeMs].join(':');}
function capture(file:string,max:number):Capture{
 const parents=rootParents(file),before=lstatSync(file);
 if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.gid!==0||before.nlink!==1||(before.mode&0o777)!==0o600||before.size<1||before.size>max)refuse('private_file');
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(signature(before)!==signature(fstatSync(fd)))refuse('file_open_race');
  const bytes=Buffer.alloc(before.size);let at=0;while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,at);if(!n)refuse('short_file');at+=n;}
  if(readSync(fd,Buffer.alloc(1),0,1,at)!==0||signature(before)!==signature(fstatSync(fd))||signature(before)!==signature(lstatSync(file))||rootParents(file)!==parents)refuse('file_read_race');
  return Object.freeze({path:file,bytes,sha256:sha(bytes),fingerprint:signature(before)+'|'+parents});
 }finally{closeSync(fd);}
}
function current(c:Capture){const next=capture(c.path,c.bytes.length);if(next.fingerprint!==c.fingerprint||next.sha256!==c.sha256)refuse('input_changed');}
function parentSync(file:string){const fd=openSync(dirname(file),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function exclusive(file:string,bytes:Buffer){
 rootParents(file);const fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{const s=fstatSync(fd);if(!s.isFile()||s.uid!==0||s.gid!==0||s.nlink!==1||(s.mode&0o777)!==0o600)refuse('new_file_mode');let at=0;while(at<bytes.length){const n=writeSync(fd,bytes,at,bytes.length-at,at);if(!n)refuse('short_write');at+=n;}fsyncSync(fd);}finally{closeSync(fd);}parentSync(file);
}
function record(file:string,value:unknown){const wire=Buffer.from(canonicalJson(value)+'\n');if(wire.length>65536)refuse('record_bound');exclusive(file,wire);}
function phasePath(phase:Phase,kind:'intent'|'ack'|'unknown'){return `${SERVER1_HELD.directory}/postgres17-server1-held-target.${phase}.${kind}.json`;}
function freshFiles(){
 rootParents(SERVER1_HELD.receipt);rootParents(SERVER1_HELD.application);rootParents(SERVER1_HELD.reader);
 if(existsSync(SERVER1_HELD.receipt)||existsSync(SERVER1_HELD.application)||existsSync(SERVER1_HELD.reader)||readdirSync(SERVER1_HELD.directory).some(n=>n.startsWith('postgres17-server1-held-target.')))refuse('existing_or_partial_apply');
}
/** PostgreSQL's SCRAM verifier format. Password bytes never enter SQL or ENV. */
export function server1ScramVerifier(password:string,salt:Uint8Array):string{
 if(!/^[a-f0-9]{48}$/.test(password)||salt.byteLength!==16)refuse('scram_input');
 const salted=pbkdf2Sync(password,salt,4096,32,'sha256'),client=createHmac('sha256',salted).update('Client Key').digest(),stored=createHash('sha256').update(client).digest(),server=createHmac('sha256',salted).update('Server Key').digest();
 salted.fill(0);client.fill(0);return `SCRAM-SHA-256$4096:${Buffer.from(salt).toString('base64')}$${stored.toString('base64')}:${server.toString('base64')}`;
}
export function server1RoleSql(applicationVerifier:string,readerVerifier:string){
 const verifier=/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;
 if(!verifier.test(applicationVerifier)||!verifier.test(readerVerifier)||applicationVerifier===readerVerifier)refuse('role_verifier');
 return `BEGIN;
 CREATE ROLE keryx_owner NOLOGIN NOINHERIT;
 CREATE ROLE keryx_app LOGIN NOINHERIT CONNECTION LIMIT 8 PASSWORD '${applicationVerifier}';
 CREATE ROLE keryx_reader LOGIN NOINHERIT CONNECTION LIMIT 4 PASSWORD '${readerVerifier}';
 CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
 COMMIT;`;
}
export function server1DatabaseSql(database:'keryx_source'|'keryx_mainnet'){
 if(!['keryx_source','keryx_mainnet'].includes(database))refuse('database_name');
 return `CREATE DATABASE ${database} WITH TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' CONNECTION LIMIT 16 ALLOW_CONNECTIONS false;`;
}
export function server1HeldCliMode(args:readonly string[]):'preflight'|'apply'{
 if(args.length===0||args.length===1&&args[0]==='--preflight')return 'preflight';if(args.length===1&&args[0]==='--apply')return 'apply';return refuse('cli');
}
function configuration(database:Database):ClientConfig{
 if(!['postgres','keryx_source','keryx_mainnet'].includes(database))refuse('database_name');
 return {host:SERVER1_HELD.socket,port:5432,database,user:'postgres',password:()=>{throw Error('Peer password challenge refused');},ssl:false,application_name:'keryx-server1-held-enrollment',connectionTimeoutMillis:2000,query_timeout:35000,options:'-c statement_timeout=30000 -c lock_timeout=1000 -c timezone=UTC -c client_encoding=UTF8 -c synchronous_commit=on',types:{getTypeParser:(oid,format)=>format!=='binary'&&(oid===114||oid===3802)?(wire:string)=>wire:types.getTypeParser(oid,format)}};
}
async function connected(database:Database){const client=new Client(configuration(database));client.on('error',()=>{});try{await client.connect();return client;}catch{await client.end().catch(()=>{});return refuse('peer_connection');}}
async function wire(client:Client,sql:string):Promise<string>{const value=(await client.query(sql)).rows[0]?.wire;if(typeof value!=='string'||Buffer.byteLength(value)>8388608)refuse('sql_wire');return value;}
export function isServer1HbaRejection(error:unknown,role:ApplicationRole,database:'keryx_source'|'keryx_mainnet'){
 if(!['keryx_app','keryx_reader'].includes(role)||!['keryx_source','keryx_mainnet'].includes(database))return false;
 return !!error&&typeof error==='object'&&Reflect.get(error,'code')==='28000'&&Reflect.get(error,'message')===`pg_hba.conf rejects connection for host "[local]", user "${role}", database "${database}", no encryption`;
}
async function hbaProbe(role:ApplicationRole,database:'keryx_source'|'keryx_mainnet',password:string){
 const client=new Client({...configuration(database),user:role,password,query_timeout:6000});client.on('error',()=>{});
 try{await client.connect();return refuse('application_connection_succeeded');}catch(error){if(!isServer1HbaRejection(error,role,database))return refuse('loaded_hba_rejection_not_proven');}finally{await client.end().catch(()=>{});}
}
export function server1HbaRules(wireText:string):string{
 if(Buffer.byteLength(wireText)>65536)refuse('hba_rules_bound');const rules=JSON.parse(wireText) as {type:string;database:string[];user_name:string[];auth_method:string;error:null|string}[];
 if(!Array.isArray(rules)||!rules.length||rules.length>32||rules.some(r=>r.error!==null||!Array.isArray(r.database)||!Array.isArray(r.user_name)))refuse('hba_rule_error');
 for(const db of ['keryx_source','keryx_mainnet'])for(const role of ['keryx_app','keryx_reader']){
  const first=rules.find(r=>r.type==='local'&&(r.database.includes('all')||r.database.includes(db))&&(r.user_name.includes('all')||r.user_name.includes(role)));
  if(!first||first.auth_method!=='reject'||!first.database.includes(db)||!first.user_name.includes(role))refuse('hba_first_match');
 }return sha(canonicalJson(rules));
}
const HBA_SQL="SELECT coalesce(jsonb_agg(jsonb_build_object('type',type,'database',database,'user_name',user_name,'auth_method',auth_method,'error',error) ORDER BY rule_number),'[]'::jsonb)::text AS wire FROM pg_hba_file_rules";
async function inspectDatabase(client:Client,expected:Database,system:string){
 const actual=JSON.parse(await wire(client,"SELECT jsonb_build_object('database',current_database(),'user',session_user,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'version',current_setting('server_version_num'),'fsync',current_setting('fsync'),'synchronousCommit',current_setting('synchronous_commit'),'fullPageWrites',current_setting('full_page_writes'))::text AS wire"));
 if(actual.database!==expected||actual.user!=='postgres'||actual.systemIdentifier!==system||actual.version!=='170012'||actual.fsync!=='on'||actual.synchronousCommit!=='on'||actual.fullPageWrites!=='on')refuse('actual_database');
}
async function emptyNamespace(client:Client,installed=false){
 const x=JSON.parse(await wire(client,"SELECT jsonb_build_object('namespaces',(SELECT coalesce(jsonb_agg(nspname ORDER BY nspname),'[]'::jsonb) FROM pg_namespace WHERE nspname NOT IN('pg_catalog','pg_toast','information_schema','public') AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'),'publicRelations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),'publicFunctions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),'extensions',(SELECT jsonb_agg(extname ORDER BY extname) FROM pg_extension))::text AS wire"));
 if(JSON.stringify(x.namespaces)!==JSON.stringify(installed?['keryx_storage']:[])||JSON.stringify(x.extensions)!=='["plpgsql"]'||!installed&&(x.publicRelations!==0||x.publicFunctions!==0))refuse('namespace');
}
async function rolesAndDatabases(client:Client,fresh:boolean){
 const value=JSON.parse(await wire(client,"SELECT jsonb_build_object('databases',(SELECT jsonb_agg(datname ORDER BY datname) FROM pg_database WHERE datname NOT IN('postgres','template0','template1')),'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypass',rolbypassrls,'limit',rolconnlimit,'settings',rolconfig,'until',rolvaliduntil) ORDER BY rolname),'[]'::jsonb) FROM pg_roles WHERE rolname<>'postgres' AND left(rolname,3)<>'pg_'),'memberships',(SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE left(r.rolname,3)<>'pg_' OR left(u.rolname,3)<>'pg_'),'applicationClients',(SELECT count(*) FROM pg_stat_activity WHERE usename IN('keryx_app','keryx_reader')))::text AS wire"));
 if(value.applicationClients!==0||value.memberships!==0)refuse('roles_or_clients');
 if(fresh){if(value.databases!==null||JSON.stringify(value.roles)!=='[]')refuse('existing_roles_or_databases');return;}
 if(JSON.stringify(value.databases)!=='["keryx_mainnet","keryx_source"]'||value.roles.length!==6)refuse('enrolled_inventory');
 const expected=['anon','authenticated','keryx_app','keryx_owner','keryx_reader','service_role'];
 for(let i=0;i<expected.length;i++){
  const r=value.roles[i],login=r.name==='keryx_app'||r.name==='keryx_reader',inherit=['anon','authenticated','service_role'].includes(r.name),limit=r.name==='keryx_app'?8:r.name==='keryx_reader'?4:-1;
  if(r.name!==expected[i]||r.login!==login||r.inherit!==inherit||r.limit!==limit||r.super||r.createDb||r.createRole||r.replication||r.bypass||r.settings!==null||r.until!==null)refuse('role_defaults');
 }
}
async function targetCensus(target:Client){
 await target.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='5s'");
 try{
 const contract=exportNativePostgresSchemaContract(await wire(target,'SELECT keryx_storage.catalog_contract()::text AS wire'));
 if(contract.sha256!==SERVER1_HELD.catalogSha256||contract.metadata.sections.functions.length!==510)refuse('catalog');
 await emptyNamespace(target,true);
 const control=JSON.parse(await wire(target,"SELECT jsonb_build_object('identity',(SELECT count(*) FROM keryx_storage.identity),'contract',(SELECT count(*) FROM keryx_storage.source_contract),'control',(SELECT jsonb_agg(jsonb_build_object('singleton',singleton,'mode',mode,'origin',origin)) FROM keryx_storage.control),'writer',(SELECT count(*) FROM keryx_storage.writer))::text AS wire"));
 if(control.identity!==0||control.contract!==0||control.writer!==0||JSON.stringify(control.control)!=='[{"mode":"held","origin":"https://keryx.cc","singleton":true}]')refuse('held_unenrolled');
 const relations=JSON.parse(await wire(target,"SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname),'[]'::jsonb)::text AS wire FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p','m') AND (n.nspname='public' OR n.nspname='keryx_storage' AND c.relname LIKE '%writer%')")) as {schema:string;name:string}[];
 if(relations.length>512)refuse('relation_bound');for(const r of relations){if(!['public','keryx_storage'].includes(r.schema)||!/^[_a-z][_a-z0-9]*$/.test(r.name))refuse('relation_name');if(await wire(target,`SELECT count(*)::text AS wire FROM "${r.schema}"."${r.name}"`)!=='0')refuse('nonempty_application_data');}
 await target.query('COMMIT');return contract.sha256;
 }catch(error){await target.query('ROLLBACK').catch(()=>{});throw error;}
}
function privateInputs(){
 const manifest=capture(SERVER1_HELD.manifest,8192),source=capture(SERVER1_HELD.sourceSql,16777216),intake=capture(SERVER1_HELD.intake,4194304);
 if(source.sha256!==SERVER1_HELD.sourceSqlSha256)refuse('source_sql');
 const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(manifest.bytes),value=JSON.parse(text.endsWith('\n')?text.slice(0,-1):text);
 if(canonicalJson(value)!==(text.endsWith('\n')?text.slice(0,-1):text)||Object.keys(value).sort().join(',')!=='backend,format,identity'||value.format!=='keryx-storage-deployment-v1'||Object.keys(value.backend??{}).sort().join(',')!=='databasePath,kind'||value.backend.kind!=='sqlite')refuse('active_sqlite_manifest');
 const identity=validateStorageIdentity(value.identity);if(identity.network!=='eip155:5042'||identity.authorityMode!=='mainnet-real')refuse('active_identity');
 return {manifest,source,intake,identityDigest:storageIdentityDigest(identity),current:()=>{current(manifest);current(source);current(intake);}};
}
/** No caller-controlled endpoint, role, credential, SQL, pin, proof or path. */
export async function enrollServer1HeldTarget(mode:'preflight'|'apply'='preflight'){
 if(arguments.length>1||!['preflight','apply'].includes(mode)||process.platform!=='linux'||process.arch!=='x64'||process.version!=='v24.22.1'||process.getuid?.()!==0)refuse('entry');
 const preparation=await inspectServer1PreparedPostgres();const inputs=privateInputs();freshFiles();
 const system=preparation.receipt.systemIdentifier;if(!/^[1-9][0-9]{9,23}$/.test(system))refuse('system_identifier');
 const admin=await connected('postgres');let target:Client|undefined,source:Client|undefined,locked=false;
 const unchanged=async()=>{inputs.current();const now=await inspectServer1PreparedPostgres();if(canonicalJson(now)!==canonicalJson(preparation))refuse('preparation_changed');inputs.current();};
 try{
  await inspectDatabase(admin,'postgres',system);await rolesAndDatabases(admin,true);const hbaRulesSha256=server1HbaRules(await wire(admin,HBA_SQL));
  if(mode==='preflight'){await unchanged();return {format:'keryx-server1-held-target-preflight-v1',readOnly:true,fresh:true,systemIdentifier:system,sourceSqlSha256:inputs.source.sha256,identityDigest:inputs.identityDigest,sourceManifestSha256:inputs.manifest.sha256,preparationSha256:preparation.fingerprints.receiptSha256,intakeSha256:inputs.intake.sha256,hbaSha256:preparation.fingerprints.configHashes.hba,hbaRulesSha256,applicationAuthority:false};}
  if((await admin.query('SELECT pg_try_advisory_lock(634781904177099::bigint) AS locked')).rows[0]?.locked!==true)refuse('concurrent_enrollment');locked=true;
  freshFiles();await rolesAndDatabases(admin,true);await unchanged();
  const operation=randomUUID(),binding={operation,systemIdentifier:system,sourceSqlSha256:inputs.source.sha256,identityDigest:inputs.identityDigest,sourceManifestSha256:inputs.manifest.sha256,preparationSha256:preparation.fingerprints.receiptSha256,intakeSha256:inputs.intake.sha256};
  record(phasePath('operation','intent'),{...binding,phase:'operation',state:'intent',at:new Date().toISOString()});
  const applicationPassword=randomBytes(24).toString('hex'),readerPassword=randomBytes(24).toString('hex');if(applicationPassword===readerPassword)refuse('random_collision');
  record(SERVER1_HELD.application,{format:'keryx-postgres-role-credential-v1',role:'keryx_app',password:applicationPassword});record(SERVER1_HELD.reader,{format:'keryx-postgres-role-credential-v1',role:'keryx_reader',password:readerPassword});
  const credentials=[capture(SERVER1_HELD.application,8192),capture(SERVER1_HELD.reader,8192)];
  const phase=async(name:Exclude<Phase,'operation'>,client:Client,sql:string)=>{
   await unchanged();for(const c of credentials)current(c);record(phasePath(name,'intent'),{...binding,phase:name,state:'intent',at:new Date().toISOString()});
   try{await client.query(sql);}catch{try{record(phasePath(name,'unknown'),{...binding,phase:name,state:'unknown',at:new Date().toISOString()});}catch{/* Keep the durable intent. No retry or cleanup. */}return refuse('unknown_'+name);}
   record(phasePath(name,'ack'),{...binding,phase:name,state:'acknowledged',at:new Date().toISOString()});await unchanged();for(const c of credentials)current(c);
  };
  const applicationVerifier=server1ScramVerifier(applicationPassword,randomBytes(16)),readerVerifier=server1ScramVerifier(readerPassword,randomBytes(16));
  await phase('roles',admin,server1RoleSql(applicationVerifier,readerVerifier));
  const storedVerifiers=JSON.parse(await wire(admin,"SELECT jsonb_object_agg(rolname,rolpassword)::text AS wire FROM pg_authid WHERE rolname IN('keryx_app','keryx_reader')"));
  if(storedVerifiers.keryx_app!==applicationVerifier||storedVerifiers.keryx_reader!==readerVerifier)refuse('stored_scram_verifier');
  await phase('create-source',admin,server1DatabaseSql('keryx_source'));
  await phase('allow-source',admin,'BEGIN; ALTER DATABASE keryx_source ALLOW_CONNECTIONS true; COMMIT;');
  await phase('create-target',admin,server1DatabaseSql('keryx_mainnet'));
  await phase('allow-target',admin,'BEGIN; GRANT CREATE ON DATABASE keryx_mainnet TO keryx_owner; ALTER DATABASE keryx_mainnet ALLOW_CONNECTIONS true; COMMIT;');
  source=await connected('keryx_source');target=await connected('keryx_mainnet');await inspectDatabase(source,'keryx_source',system);await inspectDatabase(target,'keryx_mainnet',system);await emptyNamespace(source);await emptyNamespace(target);
  await phase('schema',target,"BEGIN; SET LOCAL statement_timeout='30s'; GRANT CREATE ON SCHEMA public TO keryx_owner; CREATE PUBLICATION supabase_realtime; ALTER PUBLICATION supabase_realtime OWNER TO keryx_owner;\n"+inputs.source.bytes.toString('utf8')+'\nRESET ROLE; COMMIT;');
  await targetCensus(target);await emptyNamespace(source);await rolesAndDatabases(admin,false);
  for(const database of ['keryx_source','keryx_mainnet'] as const){
   const acl=JSON.parse(await wire(admin,`SELECT jsonb_build_object('owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='${database}'),'limit',(SELECT datconnlimit FROM pg_database WHERE datname='${database}'),'allow',(SELECT datallowconn FROM pg_database WHERE datname='${database}'),'app',has_database_privilege('keryx_app','${database}','CONNECT'),'reader',has_database_privilege('keryx_reader','${database}','CONNECT'))::text AS wire`));
   if(acl.owner!=='postgres'||acl.limit!==16||acl.allow!==true||acl.app!==true||acl.reader!==true)refuse('qualified_database_acl');
   await hbaProbe('keryx_app',database,applicationPassword);await hbaProbe('keryx_reader',database,readerPassword);
  }
  if(server1HbaRules(await wire(admin,HBA_SQL))!==hbaRulesSha256)refuse('hba_rules_changed');
  await unchanged();for(const c of credentials)current(c);await rolesAndDatabases(admin,false);await targetCensus(target);
  const oids=JSON.parse(await wire(admin,"SELECT jsonb_object_agg(datname,oid::text)::text AS wire FROM pg_database WHERE datname IN('keryx_source','keryx_mainnet')"));
  for(const name of ['keryx_source','keryx_mainnet'])if(typeof oids[name]!=='string'||!/^[1-9][0-9]{0,9}$/.test(oids[name])||BigInt(oids[name])>BigInt('4294967295'))refuse('database_oid');if(oids.keryx_source===oids.keryx_mainnet)refuse('database_oid');
  await unchanged();inputs.current();for(const c of credentials)current(c);
  const receipt={format:'keryx-server1-postgres17-held-target-v1',phase:'fresh-held-unenrolled',sourceDatabaseOid:oids.keryx_source as string,targetDatabaseOid:oids.keryx_mainnet as string,systemIdentifier:system,sourceSqlSha256:SERVER1_HELD.sourceSqlSha256,catalogSha256:SERVER1_HELD.catalogSha256,identityDigest:inputs.identityDigest,sourceManifestSha256:inputs.manifest.sha256,preparationSha256:preparation.fingerprints.receiptSha256,intakeSha256:inputs.intake.sha256,connectionDenial:'hba-reject',applicationConnectDenied:true,readerConnectDenied:true,hbaSha256:preparation.fingerprints.configHashes.hba,hbaRulesSha256,nativeFunctionCount:510,sourceTypedStagingEmpty:true,targetIdentityEmpty:true,targetContractEmpty:true,targetPublicDataEmpty:true,writerMode:'held',applicationAuthority:false,sourceRetired:false,createdAt:new Date().toISOString()};
  record(SERVER1_HELD.receipt,receipt);record(phasePath('operation','ack'),{...binding,phase:'operation',state:'acknowledged',receiptSha256:capture(SERVER1_HELD.receipt,65536).sha256,at:new Date().toISOString()});return receipt;
 }finally{await target?.end().catch(()=>{});await source?.end().catch(()=>{});if(locked)await admin.query('SELECT pg_advisory_unlock(634781904177099::bigint)').catch(()=>{});await admin.end().catch(()=>{});}
}
// Both Source ESM and the one fixed operator CJS artifact have a closed CLI.
const direct=process.argv[1]&&(typeof import.meta.url==='string'?pathToFileURL(resolve(process.argv[1])).href===import.meta.url:process.argv[1]==='/root/keryx-migration/enroll-server1-held-target.cjs');
if(direct)void Promise.resolve().then(()=>enrollServer1HeldTarget(server1HeldCliMode(process.argv.slice(2)))).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('server1_held_enrollment_refused; retain all partial artifacts and inspect before any recovery');process.exitCode=1;});
