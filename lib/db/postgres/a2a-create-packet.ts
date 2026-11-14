import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { exactA2aMicros } from '../../a2a/amount-micros';
import { validateA2aOriginalClaim,matchesA2aOriginalClaim } from '../../a2a/original-claim';
import { a2aResearchPackageFingerprint } from '../../a2a/research-package';
import type { A2aOrder } from '../../a2a/order';
import { isWellFormedAskText } from '../../ask-input';
import { monthlyOrderToRow } from '../research-monthly';
/** Fresh standalone Arc DTO only. No purchase, settlement, execution, owner
 * association or installed storage provenance is established by this capture. */
export function captureNativeA2aCreate(raw:A2aOrder){
 const wire=JSON.stringify(raw);if(typeof wire!=='string'||Buffer.byteLength(wire)>65536)throw Error('Native fresh order bound');
 const order=JSON.parse(wire) as A2aOrder,micros=(value:number)=>{const n=exactA2aMicros(value);if(n===null||n<=0)throw Error('Native fresh order amount');return String(n);};
 const binding=validateA2aOriginalClaim({id:order.id,queryId:order.queryId,requestHash:order.requestHash,payer:order.payer.toLowerCase(),payee:order.payee.toLowerCase(),authorizationId:order.authorizationId.toLowerCase(),
  amountMicroUsdc:micros(order.amountUsdc),creatorBudgetMicroUsdc:micros(order.creatorBudgetUsdc),serviceFeeMicroUsdc:micros(order.serviceFeeUsdc),packageFingerprint:a2aResearchPackageFingerprint(order.researchPackage),
  network:ARC_MAINNET_PROFILE.networkId,asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase(),gatewayContract:ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase()},ARC_MAINNET_PROFILE);
 if(!matchesA2aOriginalClaim(order,binding)||!isWellFormedAskText(order.request!.question)||order.request!.model!==undefined&&!isWellFormedAskText(order.request!.model)
  ||!isWellFormedAskText(order.transaction)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(order.createdAt)
  ||!Number.isFinite(Date.parse(order.createdAt))||new Date(order.createdAt).toISOString()!==order.createdAt||order.updatedAt!==order.createdAt)throw Error('Native fresh order refused');
 const row=monthlyOrderToRow(order);for(const field of ['request_data','package_data','response_data','resolution_data'])if(row[field]!==null)row[field]=JSON.stringify(row[field]);
 const rowWire=JSON.stringify(row);if(Buffer.byteLength(rowWire)>65536)throw Error('Native fresh original bound');
 return Object.freeze({order,binding:Object.freeze(binding),row:Object.freeze(row),rowWire});
}
