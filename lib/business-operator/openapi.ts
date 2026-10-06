import { operatorBusinessStatusSchema,operatorDecisionSchema } from "./contracts";
const count={type:"integer",minimum:0};
const nullable=(schema:object)=>({anyOf:[schema,{type:"null"}]});
const object=(properties:Record<string,object>)=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const timestamp={type:"string",format:"date-time"};
const decision=object({action:{type:"string",enum:operatorDecisionSchema.shape.action.options},
  reason:{type:"string",enum:operatorDecisionSchema.shape.reason.options},
  liquidity:{type:"string",enum:operatorDecisionSchema.shape.liquidity.options},observedAt:timestamp});
const jobs=object({
  ...Object.fromEntries(["queued","processing","reviewRequired","completedLast24h","failedLast24h"].map(key=>[key,count])),
  ...Object.fromEntries(["oldestQueuedAgeSeconds","oldestProcessingAgeSeconds","completionLatencyP50Ms","completionLatencyP95Ms"].map(key=>[key,nullable(count)])),
  completionRateLast24h:nullable({type:"number",minimum:0,maximum:1}),degraded:{type:"boolean"},
});
export const operatorStatusOpenApiPath={get:{operationId:"operatorBusinessStatus",summary:"Observe public prepaid business operations",
  description:"Read-only aggregate status and audited decision rationale. Unavailable fields remain null; old heartbeats are stale. No books, signer, customer questions or job identifiers. This observation grants no execution authority.",
  security:[],responses:{"200":{description:"Identifier-free public observation, including unknown and stale states.",content:{"application/json":{
    schema:object({version:{type:"integer",const:1},network:{type:"string",enum:operatorBusinessStatusSchema.shape.network.options},
      operator:object({state:{type:"string",enum:operatorBusinessStatusSchema.shape.operator.shape.state.options},
        observedAt:nullable(timestamp),decision:nullable(decision),auditRecorded:{type:"boolean"}}),
      jobs:nullable(jobs),creatorCatalog:object({registered:nullable(count)})}),
  }}},"503":{description:"Public observation unavailable; never interpreted as zero."}}}};
