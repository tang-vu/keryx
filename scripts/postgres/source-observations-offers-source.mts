import {createHash} from 'node:crypto';
import {nativePaymentBrowserSource} from './payment-browser-source.mts';
import {nativeArticleOffersSourceAddition} from './article-offers-source.mts';
/** Independently built fresh subset only; no installed writer admission. */
export function nativeSourceObservationsOffersSource(){
 const sql=nativePaymentBrowserSource().sql+'\n'+nativeArticleOffersSourceAddition().sql;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Source provenance, verification and article-offer subset. Full retained intake, complete writer and production cutover remain separate.'});
}
