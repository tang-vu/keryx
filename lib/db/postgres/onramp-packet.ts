import { createHash } from 'node:crypto';
import type { OnrampReservation } from '../keryx-db';

export const ONRAMP_PROTOCOL_LIMITS=Object.freeze({inputBytes:65536,frameBytes:4194304,keyWireBytes:16384,attempts:16,deadlineMs:15000});
const numberWire=(value:number)=>Object.is(value,-0)?'-0':String(value);
function keyWire(value:string){if(typeof value!=='string')throw Error('Onramp key unavailable');const wire=JSON.stringify(value);if(Buffer.byteLength(wire)>ONRAMP_PROTOCOL_LIMITS.keyWireBytes)throw Error('Onramp key operation bound');return wire;}
function numeric(value:number){if(typeof value!=='number')throw Error('Onramp numeric input unavailable');return numberWire(value);}
export type OnrampCapture=Readonly<{
 action:'reserve'|'release';addressKeyWire:string;dayKeyWire:string;amount:string;dailyCap:string|null;now:string|null;
}>;
export function captureOnrampReserve(addressKey:string,dayKey:string,amount:number,dailyCap:number,now:number):OnrampCapture{
 return Object.freeze({action:'reserve',addressKeyWire:keyWire(addressKey),dayKeyWire:keyWire(dayKey),amount:numeric(amount),dailyCap:numeric(dailyCap),now:numeric(now)});
}
export function captureOnrampRelease(addressKey:string,dayKey:string,amount:number):OnrampCapture{
 return Object.freeze({action:'release',addressKeyWire:keyWire(addressKey),dayKeyWire:keyWire(dayKey),amount:numeric(amount),dailyCap:null,now:null});
}
export const onrampWireSha256=(wire:string)=>createHash('sha256').update(wire).digest('hex');
export function onrampPacketWire(value:unknown){const wire=JSON.stringify(value);if(Buffer.byteLength(wire)>ONRAMP_PROTOCOL_LIMITS.inputBytes)throw Error('Onramp packet operation bound');return wire;}
interface SyncRow {value:string;updatedAt:string|null;}
export interface OnrampFrame {
 format:'source-onramp-frame-v1';identityDigest:string;capture:OnrampCapture;addressHex:string;dayHex:string;claimed:boolean;address:SyncRow|null;day:SyncRow|null;
}
function row(value:unknown):value is SyncRow{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='updatedAt,value'&&typeof (value as SyncRow).value==='string'&&((value as SyncRow).updatedAt===null||typeof (value as SyncRow).updatedAt==='string');}
/** A frame hash binds observations; it never supplies installed provenance or
 * authorizes a transfer. The fixed SQL independently checks its current frame. */
export function decodeOnrampFrame(raw:unknown,capture:OnrampCapture){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='sha256,wire')throw Error('Onramp frame unavailable');
 const envelope=raw as {wire:unknown;sha256:unknown};
 if(typeof envelope.wire!=='string'||Buffer.byteLength(envelope.wire)>ONRAMP_PROTOCOL_LIMITS.frameBytes||typeof envelope.sha256!=='string'||onrampWireSha256(envelope.wire)!==envelope.sha256)throw Error('Onramp frame unavailable');
 const frame=JSON.parse(envelope.wire) as OnrampFrame;
 const hex=(wire:string)=>Buffer.from(JSON.parse(wire) as string).toString('hex');
 if(!frame||Object.keys(frame).sort().join(',')!=='address,addressHex,capture,claimed,day,dayHex,format,identityDigest'||frame.format!=='source-onramp-frame-v1'||!(/^[a-f0-9]{64}$/).test(frame.identityDigest)||typeof frame.claimed!=='boolean'
  ||Object.keys(frame.capture??{}).sort().join(',')!==Object.keys(capture).sort().join(',')||Object.keys(capture).some(key=>frame.capture[key as keyof OnrampCapture]!==capture[key as keyof OnrampCapture])
  ||frame.addressHex!==hex(capture.addressKeyWire)||frame.dayHex!==hex(capture.dayKeyWire)||frame.address!==null&&!row(frame.address)||frame.day!==null&&!row(frame.day))throw Error('Onramp frame binding unavailable');
 if(capture.action==='reserve'&&(frame.address!==null||frame.claimed&&frame.day!==null)||capture.action==='release'&&frame.claimed!==(frame.address!==null))throw Error('Onramp frame presence unavailable');
 if(frame.addressHex===frame.dayHex&&(capture.action==='reserve'&&!frame.claimed&&frame.day!==null||capture.action==='release'&&(frame.address?.value!==frame.day?.value||frame.address?.updatedAt!==frame.day?.updatedAt)))throw Error('Onramp frame alias unavailable');
 return Object.freeze({frame,sha256:envelope.sha256});
}
export type OnrampEffect=Readonly<
 {action:'reserve';addressValue:string;dayValue:string;updatedAt:string}|
 {action:'release';dayValue:string;dayExistsAfterDelete:boolean}
>;
export function prepareOnrampEffect(capture:OnrampCapture,observed:ReturnType<typeof decodeOnrampFrame>):Readonly<{result:OnrampReservation|null;effect:OnrampEffect|null}>{
 const frame=observed.frame;
 // Source checks address presence BEFORE reading/parsing the day or Date(now).
 if(capture.action==='reserve'&&frame.claimed)return {result:'already-funded',effect:null};
 const amount=Number(capture.amount),alias=frame.addressHex===frame.dayHex;
 const day=capture.action==='release'&&alias?null:frame.day;
 const total=Number.parseFloat(day?.value??'0')||0;
 if(capture.action==='reserve'){
  const next=total+amount;if(next>Number(capture.dailyCap)+1e-9)return {result:'daily-cap',effect:null};
  // TimeClip failure must remain AFTER both Source early-return branches.
  const now=Number(capture.now),updatedAt=new Date(now).toISOString();
  return {result:'reserved',effect:Object.freeze({action:'reserve',addressValue:String(now),dayValue:String(next),updatedAt})};
 }
 return {result:null,effect:Object.freeze({action:'release',dayValue:String(Math.max(0,total-amount)),dayExistsAfterDelete:day!==null})};
}
