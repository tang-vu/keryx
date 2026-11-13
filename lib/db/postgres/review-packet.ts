import { canonicalJson } from '../../canonical-json';
import { captureDecisionSchema } from '../../research/decision-review-types';
/** The raw wire is retained separately. SQL only needs these bounded fields;
 * sourceName can contain an escaped NUL accepted by the current SQLite API. */
export function reviewOriginalMetadata(raw:string){
 const input=captureDecisionSchema.parse(JSON.parse(raw)),{sourceName,...metadata}=input;void sourceName;return metadata;
}
export function captureReviewPacket(raw:unknown){
 const input=captureDecisionSchema.parse(raw),inputWire=canonicalJson(input);
 return {inputWire,metadata:reviewOriginalMetadata(inputWire)};
}
