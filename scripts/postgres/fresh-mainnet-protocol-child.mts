/** Fixed host child. No application module is imported before environment and
 * network constraints are installed. Its probe never qualifies native storage. */
import { readSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire,syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
const emit=process.stdout.write.bind(process.stdout);let finished=false,stage='input';
Object.defineProperty(process.stdout,'write',{value:()=>true});Object.defineProperty(process.stderr,'write',{value:()=>true});
function finish(value:unknown,code:number){
 if(finished)return;finished=true;const wire=JSON.stringify(value);
 emit(Buffer.byteLength(wire)<=65536?wire:'{"passed":false,"stage":"report"}',()=>process.exit(code));
}
const fail=()=>finish({passed:false,stage,reason:'fresh-mainnet-protocol-unavailable'},1);
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
const unavailable=()=>new Error('Fixture network unavailable');
async function main(){
 const probe=process.argv.length===3&&process.argv[2]==='--bootstrap-probe';
 if(process.argv.length!==(probe?3:2))throw unavailable();
 const buffer=Buffer.alloc(8193);let size=0;while(size<buffer.length){const read=readSync(0,buffer,size,buffer.length-size,null);if(!read)break;size+=read;}if(size>8192)throw unavailable();
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)));
 stage='environment';
 const allowed=new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','LOGONSERVER','SYSTEMDRIVE','USERDOMAIN','USERNAME','TEMP','TMP','TMPDIR','NODE_NO_WARNINGS','KERYX_NETWORK','NEXT_PUBLIC_KERYX_NETWORK','KERYX_FORCE_OFFLINE','KERYX_EXTERNAL_DISCOVERY',
  'KERYX_STORAGE_MANIFEST','KERYX_SQLITE_PATH','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','KERYX_RUN_PRIVACY_ENABLED','KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED','KERYX_PUBLIC_PROFILES_ENABLED','KERYX_REGISTRY_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS',
  'AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_MAINNET_TREASURY_PRIVATE_KEY','KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY','KERYX_BOT_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','DEEPSEEK_API_KEY','TAVILY_API_KEY','CONTENT_MASTER_KEY']);
 if(Object.keys(process.env).some(key=>!allowed.has(key.toUpperCase())))throw unavailable();
 if(process.env.KERYX_NETWORK!=='arc'||process.env.NEXT_PUBLIC_KERYX_NETWORK!=='arc'||process.env.KERYX_FORCE_OFFLINE!=='0'||process.env.KERYX_EXTERNAL_DISCOVERY!=='0')throw unavailable();
 if(process.env.KERYX_REGISTRY_ADDRESS!=='0x'+'11'.repeat(20)||process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS!==process.env.KERYX_REGISTRY_ADDRESS)throw unavailable();
 for(const name of ['NODE_OPTIONS','NODE_PATH','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSERVICE','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','DOCKER_HOST','DOCKER_CONTEXT'])if(process.env[name])throw unavailable();
 for(const name of ['KERYX_STORAGE_MANIFEST','KERYX_SQLITE_PATH','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_MAINNET_TREASURY_PRIVATE_KEY','KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY','KERYX_BOT_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','DEEPSEEK_API_KEY','TAVILY_API_KEY','CONTENT_MASTER_KEY'])if(process.env[name])throw unavailable();
 // Shape validation imports no buyer/profile selector. The real selector is
 // loaded below only after all fresh environment/network gates are active.
 const {captureFreshMainnetProtocolInput}=await import('./fresh-mainnet-protocol.mts'),input=captureFreshMainnetProtocolInput(raw);
 stage='network';const require=createRequire(import.meta.url),net=require('node:net') as typeof import('node:net');
 const proxies=await import('./commit-ack-loss.mts');let denied=0;
 const deny=()=>{denied++;throw unavailable();};
 const connect=net.Socket.prototype.connect,listen=net.Server.prototype.listen;
 Object.defineProperty(net.Socket.prototype,'connect',{value:function(this:import('node:net').Socket,...given:unknown[]){
  const args=Array.isArray(given[0])?given[0] as unknown[]:given;let host:unknown,port:unknown;
  if(args[0]&&typeof args[0]==='object'){
   const value=args[0] as Record<string,unknown>;if(Object.keys(value).some(key=>!['host','port','family'].includes(key))||value.family!==undefined&&value.family!==4)return deny();
   host=value.host;port=value.port;
  }else{port=args[0];host=args[1];}
  if(host!=='127.0.0.1'||!Number.isSafeInteger(port)||Number(port)!==input.options.endpoint.port&&!proxies.isCommitAckLossProxyFor(Number(port),input.options.endpoint.port))return deny();
  return Reflect.apply(connect,this,given);
 }});
 Object.defineProperty(net.Server.prototype,'listen',{value:function(this:import('node:net').Server,...args:unknown[]){
  if(!proxies.isCommitAckLossServerFor(this,input.options.endpoint.port)||args[0]!==0||args[1]!=='127.0.0.1')return deny();
  return Reflect.apply(listen,this,args);
 }});
 for(const name of ['node:http','node:https']){const module=require(name);module.request=deny;module.get=deny;module.createServer=deny;}
 require('node:tls').connect=deny;require('node:http2').connect=deny;require('node:dgram').createSocket=deny;
 const dns=require('node:dns'),lookup=dns.lookup;
 for(const key of Object.keys(dns))if((key.startsWith('resolve')||key==='reverse')&&typeof dns[key]==='function')dns[key]=deny;
 // Node's numeric-IPv4 lookup short circuit performs no DNS request. The real
 // Server.listen path needs it even for the literal loopback bind.
 dns.lookup=(host:unknown,...args:unknown[])=>host==='127.0.0.1'?Reflect.apply(lookup,dns,[host,...args]):deny();
 for(const key of Object.keys(dns.promises))if(typeof dns.promises[key]==='function')dns.promises[key]=deny;
 globalThis.fetch=async()=>deny();Object.defineProperty(globalThis,'WebSocket',{value:class{constructor(){deny();}},configurable:true});syncBuiltinESMExports();
 stage='profile';const {BUYER_NETWORK}=await import('../../lib/buyer/protocol');if(BUYER_NETWORK!=='eip155:5042')throw unavailable();
 if(probe){stage='probe-denials';
  const expectDenied=async(operation:()=>unknown)=>{const before=denied;try{await operation();throw unavailable();}catch{if(denied!==before+1)throw unavailable();}};
  await expectDenied(()=>fetch('https://bootstrap-probe.invalid'));
  for(const name of ['node:http','node:https'])await expectDenied(()=>require(name).request('http://127.0.0.1/'));
  await expectDenied(()=>require('node:tls').connect({host:'127.0.0.1',port:input.options.endpoint.port}));
  await expectDenied(()=>net.connect({host:'bootstrap-probe.invalid',port:443}));
  await expectDenied(()=>net.connect({host:'::1',port:input.options.endpoint.port}));
  await expectDenied(()=>net.connect({host:'127.0.0.1',port:input.options.endpoint.port===65535?1:input.options.endpoint.port+1}));
  await expectDenied(()=>net.createServer().listen(0,'127.0.0.1'));
  await expectDenied(()=>dns.lookup('bootstrap-probe.invalid',()=>{}));
  const roundtrip=async(port:number)=>{const peer=net.connect({host:'127.0.0.1',port});peer.on('error',()=>{});try{await once(peer,'connect');const data=once(peer,'data');peer.write('synthetic-bootstrap-probe');await data;}finally{const closed=once(peer,'close');peer.destroy();await closed;}};
  stage='probe-direct';await roundtrip(input.options.endpoint.port);
  stage='probe-proxy';const proxy=await proxies.startCommitAckLossProxy(input.options.endpoint.port);try{if(!proxies.isCommitAckLossProxyFor(proxy.port,input.options.endpoint.port))throw unavailable();await roundtrip(proxy.port);}finally{await proxy.close();}
  stage='probe-cleanup';if(proxies.isCommitAckLossProxyFor(proxy.port,input.options.endpoint.port))throw unavailable();
  return finish({format:'keryx-fresh-mainnet-bootstrap-probe-v1',passed:true,buyerNetwork:BUYER_NETWORK,denied,loopbackProbe:true,registeredProxyProbe:true,spendingKeysScrubbed:true,installedNativeWriterQualified:false,productionData:false},0);
 }
 stage='protocol';const {Client}=await import('pg'),{postgresPoolConfiguration}=await import('../../lib/db/postgres/connection');
 const app=new Client(postgresPoolConfiguration(input.options));app.on('error',()=>{});let ended=false;
 try{
  await app.connect();
  const ownerSql=(statement:string)=>{
   if(typeof statement!=='string'||statement.includes('\0')||Buffer.byteLength(statement)>8*1024*1024)throw unavailable();
   return execFileSync('docker',['exec','-i',input.postgresContainer,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','native_target'],
    {input:statement,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
  };
  const args={options:input.options,identity:input.identity,digest:input.digest,contentionClient:app,ownerSql};
  const report:unknown=input.mode==='private'?await(await import('./qualify-private-research.mts')).qualifyPrivateResearch(args)
   :await(await import(new URL('./qualify-browser-journal.mts',import.meta.url).href)).qualifyBrowserJournal(args);
  if(!report||typeof report!=='object'||Array.isArray(report)||Object.keys(report).length>128||Object.entries(report).some(([key,value])=>!/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(key)||typeof value!=='boolean'&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)))throw unavailable();
  const result=report as Record<string,boolean|number>;if(denied!==0||result.productionData!==false||result.installedNativeWriterQualified===true||result.fullWriterQualified===true||['paymentActions','providerActions','providerCalls','jobExecutions','productionSignatures'].some(key=>key in result&&result[key]!==0))throw unavailable();
  stage='close';await app.end();ended=true;
  finish({format:'keryx-fresh-mainnet-protocol-v1',mode:input.mode,passed:true,network:BUYER_NETWORK,qualifier:result,hostChild:true,spawnedPostgres:false,selectedApplicationWriter:false},0);
 }finally{if(!ended)await app.end().catch(()=>{});}
}
void main().catch(fail);
