import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({crlf:false}));
vi.mock('node:fs',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs')>();
 return {...actual,readFileSync:(...args:Parameters<typeof actual.readFileSync>)=>{
  const value=Reflect.apply(actual.readFileSync,actual,args);
  if(args[0] instanceof URL&&args[0].pathname.endsWith('/article-offers.sql')&&typeof value==='string'){
   const lf=value.replaceAll('\r\n','\n');return state.crlf?lf.replaceAll('\n','\r\n'):lf;
  }
  return value;
 }};
});
import {nativeArticleOffersSourceAddition} from './article-offers-source.mts';
import {nativeCurrentProducersSource} from './current-producers-source.mts';
beforeEach(()=>{state.crlf=false;});
it('constructs byte-identical bounded offer and complete current Source on LF and CRLF checkouts',()=>{
 const lfOffer=nativeArticleOffersSourceAddition(),lfCurrent=nativeCurrentProducersSource();
 state.crlf=true;
 const crlfOffer=nativeArticleOffersSourceAddition(),crlfCurrent=nativeCurrentProducersSource();
 expect(crlfOffer).toEqual(lfOffer);expect(crlfCurrent).toEqual(lfCurrent);
 expect(crlfOffer.sql).not.toContain('\r');expect(crlfCurrent.sql).not.toContain('\r');
 expect(Buffer.byteLength(crlfOffer.sql)).toBeLessThanOrEqual(32768);
});
