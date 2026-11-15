import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ARC_MAINNET_PROFILE} from '../../lib/arc-network-profile';
import {nativePaymentBrowserSource} from './payment-browser-source.mts';
import {nativeArticleOffersSourceAddition} from './article-offers-source.mts';
/** Independently constructed fresh Source for producer qualifications. No
 * installed profile, target discovery, writer admission or deployment command. */
export function nativeCurrentProducersSource(){
 const part=(name:string,limit=32768)=>{
  const value=readFileSync(new URL('../../ops/keryx-postgres/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
  if(Buffer.byteLength(value)>limit)throw Error('Current producer Source part bound: '+name);return value;
 };
 let privateResearch=part('private-research.sql');
 if(privateResearch.split('{{USDC_ADDRESS}}').length!==2)throw Error('Private Source asset constructor refused');
 privateResearch=privateResearch.replace('{{USDC_ADDRESS}}',ARC_MAINNET_PROFILE.usdcAddress.toLowerCase());
 if(Buffer.byteLength(privateResearch)>32768)throw Error('Private expanded Source part bound');
 const sql=[nativePaymentBrowserSource(true).sql,nativeArticleOffersSourceAddition().sql,
  part('operator-withdrawal.sql'),part('payment-observers.sql'),part('reference-archive.sql'),part('onramp.sql'),
  part('private-research-raw.sql'),privateResearch,part('private-research-originals.sql'),
  part('registration-sponsor-corpus.sql'),part('registration-sponsor.sql'),
  part('scholarly.sql'),part('native-runtime.sql',16384)].join('\n');
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Fresh bounded current producer Source only. All actual protocols, retained intake, genuine application consumers, full writer and production cutover require separate acceptance.'});
}
