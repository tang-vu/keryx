import type {WithdrawalRecord} from '../../types';
import type {OperatorInventoryInput} from '../../business-operator/inventory';
import type {OperatorInventory,OperatorPublicSnapshot} from '../../business-operator/contracts';
import {validateStorageIdentity,type StorageIdentity} from '../storage-identity';
import {PostgresStorageUnavailable} from './connection';
import {PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel} from './domain-channel';
import {captureOperatorInventory,captureOperatorPublic,captureWithdrawalSource,reduceOperatorInventory,reduceOperatorPublic} from './operator-withdrawal-packet';
export interface PostgresOperatorWithdrawalPort{
 recordWithdrawal(value:WithdrawalRecord):Promise<void>;
 operatorInventory(input:OperatorInventoryInput):Promise<OperatorInventory>;
 operatorPublicSnapshot(nowMs:number):Promise<OperatorPublicSnapshot>;
}
/** Protocol-only closed port. Parent-owned genuine facade guards must validate
 * the same selected full manifest/all9 identity before and after awaits. No DTO,
 * callback, copied identity or this composition can issue that authority. */
export function composePostgresOperatorWithdrawal(channel:PostgresDomainChannel,identity:StorageIdentity,readOnly:boolean):PostgresOperatorWithdrawalPort{
 const expected=validateStorageIdentity(identity);if(typeof readOnly!=='boolean')throw new PostgresStorageUnavailable();
 const live=()=>{if(channel.closed)throw new PostgresStorageUnavailable();};
 const call=(name:string,args:string[])=>channel.call(name as Parameters<PostgresDomainChannel['call']>[0],args);
 return Object.freeze({
  async recordWithdrawal(value:WithdrawalRecord){live();if(readOnly)throw new PostgresStorageUnavailable();const captured=captureWithdrawalSource(value);if(captured.cells.network!==Buffer.from(expected.network).toString('hex'))throw new PostgresStorageUnavailable();const result=await call('withdrawalSourceRecord',[captured.wire]);if(channel.closed||typeof result!=='boolean')throw new PostgresDomainWriteOutcomeUnknown();if(!result)throw new Error('Withdrawal record readback unavailable or conflicting');},
  async operatorInventory(value:OperatorInventoryInput){live();const input=captureOperatorInventory(value,expected.network),result=await call('operatorSourceInventory',[JSON.stringify({})]);live();try{return reduceOperatorInventory(result,input);}catch{throw new PostgresStorageUnavailable();}},
  async operatorPublicSnapshot(nowMs:number){live();const input=captureOperatorPublic(nowMs),result=await call('operatorSourcePublic',[JSON.stringify({since:input.since})]);live();try{return reduceOperatorPublic(result,input.nowMs);}catch{throw new PostgresStorageUnavailable();}},
 });
}
