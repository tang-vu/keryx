/** Recording/Source tests only: no real server, enrollment or Native proof. */
import {createHmac,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {canonicalJson} from '../../lib/canonical-json';
import {STORAGE_MAINNET_PROFILE_DIGEST} from '../../lib/db/storage-identity';
import {nativeCurrentProducersSource} from './current-producers-source.mts';

const model=vi.hoisted(()=>({files:new Map<string,Buffer>(),fds:new Map<number,string>(),events:[] as string[],queries:[] as string[],connections:[] as Record<string,unknown>[],nextFd:20,roles:false,databases:[] as string[],installed:false,failCreate:false,failHba:false,wrongCatalog:false,changeManifest:false,readOids:false,seedVariant:'' as ''|'changed'|'extra'|'nonseed'|'missing',unsafe:'' as ''|'mode'|'hardlink'|'symlink',verifiers:{} as Record<string,string>,inspection:vi.fn()}));
function rootPath(x:unknown):x is string{return typeof x==='string'&&(x==='/'||x.startsWith('/root'));}
vi.mock('node:path',async original=>{const actual=await original<typeof import('node:path')>();return {...actual,resolve:(...parts:string[])=>parts[0]?.startsWith('/')?actual.posix.resolve(...parts):actual.resolve(...parts)};});
vi.mock('node:fs',async original=>{
 const actual=await original<typeof import('node:fs')>();
 const directory=(p:string)=>!model.files.has(p),stat=(p:string)=>({dev:1,ino:p.length,uid:0,gid:0,mode:directory(p)?0o40700:model.unsafe==='mode'?0o100644:0o100600,nlink:!directory(p)&&model.unsafe==='hardlink'?2:1,size:model.files.get(p)?.length??0,mtimeMs:1,ctimeMs:1,isDirectory:()=>directory(p),isFile:()=>!directory(p),isSymbolicLink:()=>!directory(p)&&model.unsafe==='symlink'});
 return {...actual,
  lstatSync:(p:unknown,...rest:unknown[])=>rootPath(p)?stat(p):Reflect.apply(actual.lstatSync,actual,[p,...rest]),
  realpathSync:(p:unknown,...rest:unknown[])=>rootPath(p)?p:Reflect.apply(actual.realpathSync,actual,[p,...rest]),
  existsSync:(p:unknown)=>rootPath(p)?model.files.has(p):actual.existsSync(p as string),
  readdirSync:(p:unknown,...rest:unknown[])=>rootPath(p)?[...model.files.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(String(p).length+1).includes('/')).map(k=>k.slice(String(p).length+1)):Reflect.apply(actual.readdirSync,actual,[p,...rest]),
  openSync:(p:unknown,flags:number,...rest:unknown[])=>{
   if(!rootPath(p))return Reflect.apply(actual.openSync,actual,[p,flags,...rest]);
   if(flags&actual.constants.O_EXCL){if(model.files.has(p))throw Object.assign(Error('EEXIST'),{code:'EEXIST'});model.files.set(p,Buffer.alloc(0));model.events.push('exclusive:'+p);}
   const fd=model.nextFd++;model.fds.set(fd,p);return fd;
  },
  fstatSync:(fd:number,...rest:unknown[])=>model.fds.has(fd)?stat(model.fds.get(fd)!):Reflect.apply(actual.fstatSync,actual,[fd,...rest]),
  readSync:(fd:number,out:Buffer,offset:number,length:number,position:number)=>{const p=model.fds.get(fd);if(!p)return actual.readSync(fd,out,offset,length,position);return (model.files.get(p)??Buffer.alloc(0)).copy(out,offset,position,position+length);},
  writeSync:(fd:number,bytes:Buffer,offset:number,length:number,position:number)=>{const p=model.fds.get(fd);if(!p)return actual.writeSync(fd,bytes,offset,length,position);const old=model.files.get(p)??Buffer.alloc(0),next=Buffer.alloc(Math.max(old.length,position+length));old.copy(next);bytes.copy(next,position,offset,offset+length);model.files.set(p,next);model.events.push('write:'+p);return length;},
  fsyncSync:(fd:number)=>{const p=model.fds.get(fd);if(!p)return actual.fsyncSync(fd);model.events.push('sync:'+p);},
  closeSync:(fd:number)=>{if(model.fds.has(fd)){model.fds.delete(fd);return;}return actual.closeSync(fd);},
 };
});
vi.mock('./prepare-server1-pg17.mts',()=>({inspectServer1PreparedPostgres:model.inspection}));
vi.mock('./native-contract.mts',async original=>({...await original<typeof import('./native-contract.mts')>(),exportNativePostgresSchemaContract:vi.fn((wire:string)=>{
 expect(wire).toBe('recording-wire-from-pg-text');return {sha256:model.wrongCatalog?'0'.repeat(64):'d368c98db910ff072d10d7c2a20ba3b8b2934e4f5f76c0afdd875ebfda07803f',metadata:{sections:{functions:Array(510).fill(null)}}};
})}));
const rules=[{type:'local',database:['all'],user_name:['postgres'],auth_method:'peer',error:null},{type:'local',database:['keryx_mainnet','keryx_source'],user_name:['keryx_app','keryx_reader'],auth_method:'reject',error:null},{type:'local',database:['all'],user_name:['all'],auth_method:'reject',error:null}];
const seeds:Record<string,Record<string,number|boolean>[]>={browser_journal_control:[{id:1,active:false}],browser_signing_v2_control:[{id:1,active:false,min_original_version:2}],browser_signing_v2_barrier:[{id:1,ever_active:0,min_original_version:2}]};
vi.mock('pg',async original=>{
 const actual=await original<typeof import('pg')>();
 return {...actual,Client:class{
  config:Record<string,unknown>;constructor(config:Record<string,unknown>){this.config=config;model.connections.push(config);}
  on(){return this;}
  async connect(){if(this.config.user!=='postgres')throw Object.assign(Error(model.failHba?'password authentication failed':`pg_hba.conf rejects connection for host "[local]", user "${this.config.user}", database "${this.config.database}", no encryption`),{code:model.failHba?'28P01':'28000'});}
  async end(){}
  async query(sql:string){
   model.queries.push(sql);model.events.push('sql:'+sql.slice(0,50));
   const row=(value:unknown)=>({rows:[{wire:typeof value==='string'?value:JSON.stringify(value)}]});
   if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
   if(sql.includes("'database',current_database()"))return row({database:this.config.database,user:'postgres',systemIdentifier:'7555000000000000001',version:'170012',fsync:'on',synchronousCommit:'on',fullPageWrites:'on'});
   if(sql.includes("'applicationClients'"))return row({databases:model.databases.length?[...model.databases].sort():null,roles:model.roles?['anon','authenticated','keryx_app','keryx_owner','keryx_reader','service_role'].map(name=>({name,login:['keryx_app','keryx_reader'].includes(name),inherit:['anon','authenticated','service_role'].includes(name),super:false,createDb:false,createRole:false,replication:false,bypass:false,limit:name==='keryx_app'?8:name==='keryx_reader'?4:-1,settings:null,until:null})):[],memberships:0,applicationClients:0});
   if(sql.includes('pg_hba_file_rules'))return row(rules);
   if(sql.includes('CREATE ROLE keryx_owner')){model.roles=true;for(const match of sql.matchAll(/CREATE ROLE (keryx_app|keryx_reader)[^;]+PASSWORD '([^']+)'/g))model.verifiers[match[1]]=match[2];}
   if(sql.includes('FROM pg_authid'))return row(model.verifiers);
   if(sql.startsWith('CREATE DATABASE')){const db=sql.match(/^CREATE DATABASE ([a-z_]+)/)![1];model.databases.push(db);if(model.failCreate)throw Error('synthetic lost acknowledgement');}
   if(sql.includes('CREATE PUBLICATION supabase_realtime')){model.installed=true;if(model.changeManifest)model.files.set('/root/.local/share/keryx-mainnet-runtime/production-v2/storage.json',Buffer.from('changed-after-await'));}
   if(sql.includes("'publicRelations'"))return row({namespaces:model.installed&&this.config.database==='keryx_mainnet'?['keryx_storage']:[],publicRelations:model.installed&&this.config.database==='keryx_mainnet'?100:0,publicFunctions:0,extensions:['plpgsql']});
   if(sql.includes('catalog_contract()'))return row('recording-wire-from-pg-text');
   if(sql.includes("'identity',(SELECT count(*)"))return row({identity:0,contract:0,writer:0,control:[{mode:'held',origin:'https://keryx.cc',singleton:true}]});
   if(sql.includes("'schema',n.nspname"))return row([...Object.keys(seeds).filter(name=>model.seedVariant!=='missing'||name!=='browser_signing_v2_barrier').map(name=>({schema:'public',name})),{schema:'public',name:'browser_journal_writer'},{schema:'public',name:'payment_events'},{schema:'keryx_storage',name:'writer'}]);
   if(sql.includes('count(*)::text AS wire FROM "')){const name=sql.match(/\."([a-z0-9_]+)"$/)![1];return row(Object.hasOwn(seeds,name)?model.seedVariant==='extra'?'2':'1':model.seedVariant==='nonseed'&&name==='payment_events'?'1':'0');}
   if(sql.includes('jsonb_agg(t)')&&sql.includes('FROM public."')){const name=sql.match(/FROM public\."([a-z0-9_]+)"/)![1];return row(model.seedVariant==='changed'?seeds[name].map(x=>({...x,id:2})):seeds[name]);}
   if(sql.includes("'owner',(SELECT pg_get_userbyid"))return row({owner:'postgres',limit:16,allow:true,app:true,reader:true});
   if(sql.includes('jsonb_object_agg(datname,oid::text)')){model.readOids=true;return row({keryx_source:'16384',keryx_mainnet:'16385'});}
   return {rows:[],command:'ACK'};
  }
 }};
});
import {SERVER1_HELD,enrollServer1HeldTarget,isServer1HbaRejection,server1DatabaseSql,server1HbaRules,server1HeldCliMode,server1RoleSql,server1ScramVerifier} from './enroll-server1-held-target.mts';

let sourceSql:string;
beforeAll(()=>{const source=nativeCurrentProducersSource();expect(source.sha256).toBe(SERVER1_HELD.sourceSqlSha256);sourceSql=source.sql;});
beforeEach(()=>{
 model.files.clear();model.fds.clear();model.events=[];model.queries=[];model.connections=[];model.nextFd=20;model.roles=false;model.databases=[];model.installed=false;model.failCreate=false;model.failHba=false;model.wrongCatalog=false;model.changeManifest=false;model.readOids=false;model.seedVariant='';model.unsafe='';model.verifiers={};
 const identity={format:'keryx-mainnet-storage-identity-v1',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrolledAt:'2026-11-15T00:00:00.000Z',provenanceDigest:'ab'.repeat(32)};
 model.files.set(SERVER1_HELD.manifest,Buffer.from(canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:'/root/synthetic-never-opened.sqlite'}})));
 model.files.set(SERVER1_HELD.sourceSql,Buffer.from(sourceSql));model.files.set(SERVER1_HELD.intake,Buffer.from('synthetic B0 bytes, never executed'));
 model.inspection.mockReset().mockResolvedValue({receipt:{systemIdentifier:'7555000000000000001'},fingerprints:{receiptSha256:'a'.repeat(64),configHashes:{hba:'b'.repeat(64)}}});
 const original=process;vi.stubGlobal('process',new Proxy(original,{get(target,key){if(key==='platform')return 'linux';if(key==='arch')return 'x64';if(key==='version')return 'v24.22.1';if(key==='getuid')return ()=>0;return Reflect.get(target,key);}}));
});
afterEach(()=>{vi.unstubAllGlobals();});

describe('finite readonly entry and retained phase boundaries (recording only)',()=>{
 it('defaults to readonly and rejects every alternate CLI/target selector',()=>{
  expect(server1HeldCliMode([])).toBe('preflight');expect(server1HeldCliMode(['--preflight'])).toBe('preflight');expect(server1HeldCliMode(['--apply'])).toBe('apply');
  for(const args of [['--apply','--retry'],['--host','elsewhere'],['--preflight','--apply'],['--repair'],['--apply','--proof','true']])expect(()=>server1HeldCliMode(args)).toThrow('cli');
 });
 it('runs a recording readonly preflight without a credential, journal or mutation',async()=>{
  const before=[...model.files.keys()];expect(await enrollServer1HeldTarget()).toMatchObject({readOnly:true,fresh:true,applicationAuthority:false});expect([...model.files.keys()]).toEqual(before);expect(model.events.some(x=>x.startsWith('write:'))).toBe(false);expect(model.queries.every(sql=>sql.startsWith('SELECT '))).toBe(true);
 });
 it('writes durable intents before every mutation and never sends password plaintext to SQL',async()=>{
  const manifest=Buffer.from(model.files.get(SERVER1_HELD.manifest)!);const result=await enrollServer1HeldTarget('apply');expect(result).toMatchObject({phase:'fresh-held-unenrolled',applicationAuthority:false,connectionDenial:'hba-reject',applicationConnectDenied:true,readerConnectDenied:true,catalogSha256:SERVER1_HELD.catalogSha256,targetPublicDataEmptyExceptBootstrapControls:true,mandatoryBootstrapControlRows:3});expect(result).not.toHaveProperty('targetPublicDataEmpty');
  for(const name of ['roles','create-source','allow-source','create-target','allow-target','schema']){
   const file=`/root/keryx-migration/postgres17-server1-held-target.${name}.intent.json`,write=model.events.indexOf('write:'+file),sync=model.events.indexOf('sync:'+file);expect(write).toBeGreaterThan(-1);expect(sync).toBeGreaterThan(write);expect(model.files.has(file.replace('.intent.','.ack.'))).toBe(true);
  }
  for(const database of ['source','target']){const intentSync=model.events.indexOf(`sync:/root/keryx-migration/postgres17-server1-held-target.create-${database}.intent.json`),created=model.events.findIndex(x=>x.startsWith(`sql:CREATE DATABASE keryx_${database==='source'?'source':'mainnet'}`));expect(created).toBeGreaterThan(intentSync);expect(model.events.slice(intentSync+1,created)).toContain('sync:/root/keryx-migration');}
  for(const file of [SERVER1_HELD.application,SERVER1_HELD.reader]){const password=JSON.parse(model.files.get(file)!.toString()).password;expect(password).toMatch(/^[a-f0-9]{48}$/);expect(model.queries.join('\n')).not.toContain(password);}
  expect(model.connections.filter(x=>x.user!=='postgres')).toHaveLength(4);expect(model.connections.every(x=>x.host===SERVER1_HELD.socket&&x.port===5432&&x.ssl===false)).toBe(true);expect(model.files.get(SERVER1_HELD.manifest)).toEqual(manifest);
 });
 it('retains an unknown CREATE DATABASE and refuses replay without another SQL mutation',async()=>{
  model.failCreate=true;await expect(enrollServer1HeldTarget('apply')).rejects.toThrow('unknown_create-source');expect(model.databases).toEqual(['keryx_source']);expect(model.files.has('/root/keryx-migration/postgres17-server1-held-target.create-source.unknown.json')).toBe(true);expect(model.files.has(SERVER1_HELD.receipt)).toBe(false);
  const calls=model.queries.length;await expect(enrollServer1HeldTarget('apply')).rejects.toThrow('existing_or_partial_apply');expect(model.queries).toHaveLength(calls);expect(model.queries.join('\n')).not.toMatch(/DROP|REVOKE|ALTER ROLE/);
 });
 it.each(['credential','role','database'])('refuses preexisting %s rather than adopting it',async(kind)=>{
  if(kind==='credential')model.files.set(SERVER1_HELD.application,Buffer.from('retained'));if(kind==='role')model.roles=true;if(kind==='database')model.databases=['keryx_source'];
  await expect(enrollServer1HeldTarget('apply')).rejects.toThrow(/existing/);expect(model.events.some(x=>x.startsWith('write:'))).toBe(false);
 });
 it.each(['mode','hardlink','symlink'] as const)('refuses unsafe private input %s before SQL or journal writes',async(kind)=>{model.unsafe=kind;await expect(enrollServer1HeldTarget('apply')).rejects.toThrow('private_file');expect(model.queries).toHaveLength(0);expect(model.events.some(x=>x.startsWith('write:'))).toBe(false);});
 it('refuses the whole recording result if the catalog differs',async()=>{model.wrongCatalog=true;await expect(enrollServer1HeldTarget('apply')).rejects.toThrow('catalog');expect(model.files.has(SERVER1_HELD.receipt)).toBe(false);});
 it.each(['changed','extra','nonseed','missing'] as const)('refuses %s bootstrap/application data instead of expanding the fresh allowlist',async variant=>{model.seedVariant=variant;await expect(enrollServer1HeldTarget('apply')).rejects.toThrow(/bootstrap_control|nonempty_application_data/);expect(model.files.has(SERVER1_HELD.receipt)).toBe(false);});
 it('does not call password failure an HBA denial',async()=>{model.failHba=true;await expect(enrollServer1HeldTarget('apply')).rejects.toThrow('loaded_hba_rejection_not_proven');expect(model.files.has(SERVER1_HELD.receipt)).toBe(false);});
 it('retains known schema ACK but refuses changed active manifest after await',async()=>{model.changeManifest=true;await expect(enrollServer1HeldTarget('apply')).rejects.toThrow(/input_changed|private_file/);expect(model.files.has('/root/keryx-migration/postgres17-server1-held-target.schema.ack.json')).toBe(true);expect(model.files.has(SERVER1_HELD.receipt)).toBe(false);});
 it('rechecks preparation after the final SQL await before writing a receipt',async()=>{
  model.inspection.mockImplementation(async()=>({receipt:{systemIdentifier:'7555000000000000001'},fingerprints:{receiptSha256:(model.readOids?'c':'a').repeat(64),configHashes:{hba:'b'.repeat(64)}}}));
  await expect(enrollServer1HeldTarget('apply')).rejects.toThrow('preparation_changed');expect(model.readOids).toBe(true);expect(model.files.has(SERVER1_HELD.receipt)).toBe(false);
 });
});
describe('genuine SCRAM client and finite HBA/SQL contracts',()=>{
 it('constructs verifier compatible with the installed pg SCRAM client exchange',async()=>{
  const password='ab'.repeat(24),salt=Buffer.alloc(16,7),verifier=server1ScramVerifier(password,salt),serverKey=Buffer.from(verifier.split('$')[2].split(':')[1],'base64');
  const sasl=createRequire(import.meta.url)('pg/lib/crypto/sasl'),session=sasl.startSession(['SCRAM-SHA-256']);const first=`r=${session.clientNonce}servernonce,s=${salt.toString('base64')},i=4096`;
  await sasl.continueSession(session,password,first);const auth=`n=*,r=${session.clientNonce},${first},c=biws,r=${session.clientNonce}servernonce`;
  expect(session.serverSignature).toBe(createHmac('sha256',serverKey).update(auth).digest('base64'));expect(()=>sasl.finalizeSession(session,`v=${session.serverSignature}`)).not.toThrow();
 });
 it('keeps qualified role defaults and creates disconnected fixed databases',()=>{
  const sql=server1RoleSql(server1ScramVerifier('ab'.repeat(24),Buffer.alloc(16,1)),server1ScramVerifier('cd'.repeat(24),Buffer.alloc(16,2)));expect(sql).toContain('keryx_app LOGIN NOINHERIT CONNECTION LIMIT 8');expect(sql).toContain('keryx_reader LOGIN NOINHERIT CONNECTION LIMIT 4');expect(sql).toContain('CREATE ROLE anon NOLOGIN;');expect(sql).not.toMatch(/GRANT|ALTER ROLE|SET ROLE/);
  for(const name of ['keryx_source','keryx_mainnet'] as const)expect(server1DatabaseSql(name)).toContain("CONNECTION LIMIT 16 ALLOW_CONNECTIONS false");expect(()=>server1DatabaseSql('production' as never)).toThrow();
 });
 it.each(['keryx_app','keryx_reader'] as const)('accepts only exact local HBA rejection for %s',role=>{
  for(const database of ['keryx_source','keryx_mainnet'] as const){const message=`pg_hba.conf rejects connection for host "[local]", user "${role}", database "${database}", no encryption`;expect(isServer1HbaRejection({code:'28000',message},role,database)).toBe(true);for(const error of [{code:'28P01',message},{code:'28000',message:message+' extra'},{code:'28000',message:message.replace('[local]','127.0.0.1')},Error('connection unavailable')])expect(isServer1HbaRejection(error,role,database)).toBe(false);}
 });
 it('requires finite first matching reject, no parse errors, never view-only proof',()=>{
  expect(server1HbaRules(JSON.stringify(rules))).toMatch(/^[a-f0-9]{64}$/);expect(()=>server1HbaRules(JSON.stringify([{type:'local',database:['all'],user_name:['all'],auth_method:'peer',error:null},...rules]))).toThrow('first_match');expect(()=>server1HbaRules(JSON.stringify(rules.map(x=>({...x,error:'bad syntax'}))))).toThrow('rule_error');
 });
});
