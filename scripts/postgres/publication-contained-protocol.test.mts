/** Pure refusal/format/argument checks only. No Docker, PostgreSQL, compiler,
 * supplied native factory or positive contained-qualification surrogate. */
import {describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity} from '../../lib/db/storage-identity';
import {PUBLICATION_SHARED_BYTES,PUBLICATION_HEADER_BYTES,PUBLICATION_DATA_BYTES,parsePublicationChildInput,assertPublicationLimits,assertPublicationNamespace,formatPublicationOwnerResults,publicationSqlFailure,validatePublicationObservation} from './publication-owner-sql-worker.mts';
import {PUBLICATION_DEADLINE_MS,captureContainedPublicationInput,assertPublicationFixture,publicationContainerArguments,publicationReportRecords,type ContainedPublicationInput} from './qualify-publication-contained.mts';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const input:ContainedPublicationInput={options:{endpoint:{kind:'loopback',port:15432},database:'native_target',role:'keryx_app',password:'12'.repeat(24)},identity,digest:'34'.repeat(32),postgresContainer:'keryx-postgres-consents-'+randomUUID()};
const limits={memoryMax:'536870912',swapMax:'0',cpuMax:'100000 100000',pidsMax:'64'},image='sha256:'+'56'.repeat(32);
describe('publication containment protocol without execution',()=>{
 it('captures only the fixed fixture namespace and stdin credential shape',()=>{
  expect(captureContainedPublicationInput(input)).toEqual(input);expect(parsePublicationChildInput({mode:'qualify',identity,digest:input.digest,password:input.options.password}).identity).toEqual(identity);
  for(const bad of [{...input,ownerSql:()=>''},{...input,postgresContainer:'production'},{...input,digest:'invalid'},{...input,options:{...input.options,role:'postgres'}},{...input,options:{...input.options,database:'postgres'}},{...input,options:{...input.options,password:'actual-sensitive-secret'}},{...input,options:{...input.options,endpoint:{kind:'unix',directory:'/tmp',port:5432}}}])expect(()=>captureContainedPublicationInput(bad as ContainedPublicationInput)).toThrow(/^Contained publication refused$/);
  expect(()=>parsePublicationChildInput({mode:'qualify',identity,digest:input.digest,password:input.options.password,proof:true})).toThrow();
 });
 it('requires the actual loopback host-port mapping and only the default bridge fixture',()=>{
  const fixture={Name:'/'+input.postgresContainer,Image:image,State:{Running:true,Paused:false,OOMKilled:false},Config:{User:'postgres'},HostConfig:{NetworkMode:'default'},Mounts:[],NetworkSettings:{Networks:{bridge:{}},Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'15432'}]}}};
  expect(()=>assertPublicationFixture(fixture,input,image)).not.toThrow();
  for(const value of [{...fixture,Image:'foreign'},{...fixture,State:{...fixture.State,OOMKilled:true}},{...fixture,Mounts:[{Type:'bind'}]},{...fixture,NetworkSettings:{...fixture.NetworkSettings,Networks:{bridge:{},external:{}}}},{...fixture,NetworkSettings:{...fixture.NetworkSettings,Ports:{'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'15432'}]}}}])expect(()=>assertPublicationFixture(value,input,image)).toThrow();
 });
 it('keeps the production deadline immutable and emits real resource limits without secrets',()=>{
  const owner=randomUUID(),args=publicationContainerArguments('keryx-publication-qualify-'+randomUUID(),owner,input.postgresContainer,image,'qualify');
  expect(PUBLICATION_DEADLINE_MS).toBe(300000);expect(args.slice(args.indexOf('--memory'),args.indexOf('--memory')+4)).toEqual(['--memory','512m','--memory-swap','512m']);expect(args).toContain('--read-only');expect(args).toContain('container:'+input.postgresContainer);expect(args).toContain('--max-old-space-size=256');expect(args.join(' ')).not.toContain(input.options.password);expect(args).not.toContain('-v');
  const negative=publicationContainerArguments('keryx-publication-limits-'+randomUUID(),owner,input.postgresContainer,image,'limits');expect(negative[negative.indexOf('--memory')+1]).toBe('384m');expect(()=>publicationContainerArguments('foreign',owner,input.postgresContainer,image,'qualify')).toThrow();
 });
 it('checks kernel values and refuses swap, CPU, PID or memory alternatives',()=>{
  expect(()=>assertPublicationLimits(limits)).not.toThrow();for(const bad of [{...limits,memoryMax:'402653184'},{...limits,swapMax:'max'},{...limits,swapMax:'536870912'},{...limits,cpuMax:'max 100000'},{...limits,pidsMax:'max'}])expect(()=>assertPublicationLimits(bad)).toThrow('limits_refused');
 });
 it('requires only loopback interfaces and no external IPv4 or IPv6 routes',()=>{
  const ipv4='Iface Destination Gateway Flags\n',ipv6='0'.repeat(32)+' 00 '+'0'.repeat(32)+' 00 '+'0'.repeat(32)+' 00000000 00000000 00000000 00200200 lo\n';
  expect(()=>assertPublicationNamespace(['lo'],ipv4,ipv6)).not.toThrow();expect(()=>assertPublicationNamespace(['lo','eth0'],ipv4,'')).toThrow('network_refused');expect(()=>assertPublicationNamespace(['lo'],ipv4+'eth0 00000000 0100007F 0003\n','')).toThrow();expect(()=>assertPublicationNamespace(['lo'],ipv4,'20010000000000000000000000000000 00 other lo')).toThrow();
 });
 it('formats actual simple-query result shapes without parsing JSON or dates',()=>{
  const json='{"x":1,"x":2,"nul":"\\u0000","surrogate":"\\ud800"}',date='2026-11-15 00:00:00+00';
  const results=[{rows:[]},{rows:[[true,null,Buffer.from([0,255])],[json,date,' spaced ']]},{rows:[]}];
  expect(formatPublicationOwnerResults(results)).toBe('t||\\x00ff\n'+json+'|'+date+'| spaced ');expect(formatPublicationOwnerResults({rows:[[false,123,123n]]})).toBe('f|123|123');
  expect(PUBLICATION_SHARED_BYTES).toBe(16777216);expect(PUBLICATION_DATA_BYTES+PUBLICATION_HEADER_BYTES).toBe(PUBLICATION_SHARED_BYTES);
 });
 it('bounds UTF8 output and rejects coercion of unknown objects or lone UTF16',()=>{
  expect(formatPublicationOwnerResults({rows:[['é']]},2)).toBe('é');expect(()=>formatPublicationOwnerResults({rows:[['é']]},1)).toThrow();expect(()=>formatPublicationOwnerResults({rows:[['a'],['b']]},2)).toThrow();
  for(const value of [{rows:[{body:'secret'}]},{rows:[[new Date()]]},{rows:[[undefined]]},{rows:[['\ud800']]}])expect(()=>formatPublicationOwnerResults(value)).toThrow(/^Contained publication refused$/);
 });
 it('preserves only the exact approved semantic refusal and a bounded SQLSTATE',()=>{
  expect(publicationSqlFailure({code:'P0001',message:'claim_unavailable',query:'private',detail:'signature'})).toEqual({code:'P0001',semantic:'claim_unavailable'});
  expect(publicationSqlFailure({code:'42703',message:'SECRET SQL PARAMETER'})).toEqual({code:'42703',semantic:null});expect(publicationSqlFailure({code:'secret-state',message:'claim_unavailable\nraw'})).toEqual({code:'XXXXX',semantic:null});
 });
 it('refuses leaked strings, arbitrary report fields, malformed or oversized stdout',()=>{
  expect(publicationReportRecords('{"started":true,"mode":"hang","limitsVerified":true,"namespaceVerified":true}\n')).toHaveLength(1);
  for(const wire of ['{"answer":"PRIVATE BODY"}','{"passed":true,"publication":{"signature":"PRIVATE"}}','{"passed":true,"unknown":42}','PRIVATE SQL DETAIL','x'.repeat(65537)])expect(()=>publicationReportRecords(wire)).toThrow(/^Contained publication refused$/);
  expect(()=>validatePublicationObservation({genuineSqliteOracle:true,pureFixedProtocol:true})).toThrow();
 });
});
