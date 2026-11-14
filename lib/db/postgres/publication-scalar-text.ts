/** Source string interpretations only. This module confers no storage authority.
 *
 * The selected SQLite writer binds each scalar separately from JSON.stringify's
 * original. Node's UTF-8 binding replaces an unpaired surrogate with U+FFFD and
 * retains NUL. SQLite JSON extraction instead emits the unpaired surrogate's
 * three UTF-8-shaped bytes. Keep those interpretations separate: neither may
 * rewrite a QueryRun, original JSON, delivery body, or receipt digest.
 */
export interface PublicationScalarText {
 readonly sourceHex: string;
 /** JSON string wire for the scalar-bound value, including escaped NUL. */
 readonly sourceJsonWire: string;
 /** A SQL TEXT derivative is explicitly unavailable, never an absent scalar. */
 readonly postgres: Readonly<{kind:'text';value:string}|{kind:'unrepresentable'}>;
}

/** Exact node:sqlite scalar TEXT binding, not a sanitizer for the original. */
export function publicationScalarText(value:string):Readonly<PublicationScalarText>{
 if(typeof value!=='string')throw Error('Publication scalar text required');
 const bytes=Buffer.from(value,'utf8'),bound=bytes.toString('utf8');
 return Object.freeze({sourceHex:bytes.toString('hex'),sourceJsonWire:JSON.stringify(bound),
  postgres:Object.freeze(bound.includes('\0')?{kind:'unrepresentable' as const}:{kind:'text' as const,value:bound})});
}

/** SQLite's json_extract/json_each text value for a JSON.stringify string.
 * Valid pairs combine normally; an unpaired UTF-16 code unit is emitted as
 * ED A0..BF bytes rather than scalar binding's EF BF BD. Search consumers use
 * the bytes; metadata crossing Node's UTF-8 decoder uses the decoded result.
 */
export function publicationSqliteJsonTextHex(value:string):string{
 if(typeof value!=='string')throw Error('Publication JSON text required');
 // One bounded allocation; a run of unpaired surrogates must not allocate one
 // Buffer object per code unit while capturing an otherwise bounded original.
 const bytes=Buffer.allocUnsafe(value.length*3);let used=0;
 for(let index=0;index<value.length;index++){
  let unit=value.charCodeAt(index);
  if(unit>=0xd800&&unit<=0xdbff&&index+1<value.length){
   const next=value.charCodeAt(index+1);
   if(next>=0xdc00&&next<=0xdfff){unit=0x10000+((unit-0xd800)<<10)+(next-0xdc00);index++;}
  }
  if(unit<0x80)bytes[used++]=unit;
  else if(unit<0x800){bytes[used++]=0xc0|(unit>>6);bytes[used++]=0x80|(unit&0x3f);}
  else if(unit<0x10000){bytes[used++]=0xe0|(unit>>12);bytes[used++]=0x80|((unit>>6)&0x3f);bytes[used++]=0x80|(unit&0x3f);}
  else{bytes[used++]=0xf0|(unit>>18);bytes[used++]=0x80|((unit>>12)&0x3f);bytes[used++]=0x80|((unit>>6)&0x3f);bytes[used++]=0x80|(unit&0x3f);}
 }
 return bytes.subarray(0,used).toString('hex');
}

/** json_each.value returned through node:sqlite, not the raw JSON -> token. */
export function publicationSqliteJsonTextValue(value:string):string{
 return Buffer.from(publicationSqliteJsonTextHex(value),'hex').toString('utf8');
}
