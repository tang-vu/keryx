import { describe,it,expect } from 'vitest';
import { publicProfileOriginalMetadata } from './public-profile-metadata';
import { publicRun } from '../../profiles/public-profile-projection';
import type { QueryRun } from '../../types';
const run=():QueryRun=>({id:'synthetic-public-profile',createdAt:'2026-11-13T00:00:00.000Z',question:'Visible question',answer:'Private answer',engine:'heuristic',budget:1,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[]});
const derive=(r:unknown)=>publicProfileOriginalMetadata(r,run().id,run().createdAt);
describe('original-bound native public-profile inputs',()=>{
 it('matches the existing closed public projection without retaining private fields',()=>{
  const r={...run(),asker:'0x'+'ab'.repeat(20),answer:'Do not project',trace:[{secret:'trace'}],unknown:'\0\ud800',fundingOwner:'treasury'} as unknown as QueryRun;
  const metadata=derive(r),source=JSON.parse(metadata.profileFields!);
  expect(publicRun(source,false,['eip155:5042'])).toEqual(publicRun(r,false,['eip155:5042']));
  expect(Object.keys(source).sort()).toEqual(['citations','createdAt','fundingOwner','id','question']);
  expect(metadata).toMatchObject({paymentOffline:false,fundingOffline:false,fundingTreasury:true});
 });
 it('keeps escaped public text as TEXT-compatible JSON and strips unsafe citation URLs',()=>{
  const r={...run(),question:'Question\0\ud800',citations:[{marker:'S1',sourceName:'Publisher\0\udfff',itemUrl:'https://user:secret@example.test/item?token=private',untrusted:'secret'}]} as unknown as QueryRun;
  const metadata=derive(r),wire=metadata.profileFields!;expect(wire).not.toContain('\0');expect(wire).not.toContain('secret');
  expect(publicRun(JSON.parse(wire),true,[])).toEqual(publicRun(r,true,[]));
 });
 it.each([{question:'x'.repeat(4001)},{citations:Array.from({length:51},()=>({marker:'S',sourceName:'Publisher'}))},{citations:[null]},{id:'other'},{createdAt:'2026-11-12T00:00:00.000Z'}])('withholds unsupported public shape while preserving exact ledger flags: %j',patch=>{
  expect(derive({...run(),...patch,paymentMode:'offline',fundingOwner:'treasury'})).toEqual({profileFields:null,paymentOffline:true,fundingOffline:false,fundingTreasury:true});
 });
 it.each([null,{},[],0,'offline',{paymentMode:false,fundingOwner:['offline']},{paymentMode:'Offline',fundingOwner:'TREASURY'}])('does not coerce legacy JSON literal modes: %j',input=>{
  expect(derive(input)).toEqual({profileFields:null,paymentOffline:false,fundingOffline:false,fundingTreasury:false});
 });
});
