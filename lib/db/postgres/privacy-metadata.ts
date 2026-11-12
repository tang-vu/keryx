/** Pure allowlist metadata projection; no storage or publication authority. */
type Reference={sourceHex:string;itemHex:string|null};
function metadataIdentity(raw:unknown){
 if(!raw||typeof raw!=='object')return raw;
 const value=raw as Record<string,unknown>,result:Record<string,unknown>={};
 for(const key of ['sourceId','itemId','marker','sourceKind','evidenceProvenance','sourceName','itemTitle','itemUrl','publicDeliveryKind','claimIndex','qualifiesForAnswer','qualifiesForReward','support'])if(Object.hasOwn(value,key))result[key]=value[key];
 for(const [key,keys] of [['contentReceipt',['bodyHash']],['webProvenance',['retrievedAt','extraction','truncated']]] as const){
  const nested=value[key];if(nested&&typeof nested==='object')result[key]=Object.fromEntries(keys.filter(k=>Object.hasOwn(nested,k)).map(k=>[k,Reflect.get(nested,k)]));
 }
 return result;
}
export function slimPrivacyHistoryFields(wire:unknown):{fields:string|null;references:Reference[]}{
 if(typeof wire!=='string')return {fields:null,references:[]};
 const fields=JSON.parse(wire) as [string,string,unknown][],references:Reference[]=[];let invalidReference=false;
 for(const field of fields){
  if(field[0]==='answer'&&field[1]==='text'&&typeof field[2]==='string')field[2]=field[2].trim()?'present':'';
  if(['citations','decisions','evidence'].includes(field[0])&&field[1]==='array'){
   const array=typeof field[2]==='string'?JSON.parse(field[2]):field[2];
   if(Array.isArray(array)){
    for(const raw of array){
     if(!raw||typeof raw!=='object'||typeof raw.sourceId!=='string'||raw.sourceId.length>256||raw.itemId&&typeof raw.itemId!=='string'||typeof raw.itemId==='string'&&raw.itemId.length>256){invalidReference=true;continue;}
     references.push({sourceHex:Buffer.from(raw.sourceId).toString('hex'),itemHex:typeof raw.itemId==='string'?Buffer.from(raw.itemId).toString('hex'):null});
    }
    field[2]=JSON.stringify(array.map(metadataIdentity));
   }
  }
 }
 if(invalidReference||references.length>10000||references.some(r=>r.sourceHex.length>2048||r.itemHex!==null&&r.itemHex.length>2048))return {fields:null,references:[]};
 return {fields:JSON.stringify(fields),references};
}
