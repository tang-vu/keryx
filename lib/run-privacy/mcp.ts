import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { privacyId } from "./contracts";
export function registerRunPrivacyRead(server:McpServer,read:(id:string,requestId?:string)=>Promise<Record<string,unknown>>) {
  for(const exported of [false,true])server.registerTool(exported?"run_owner_export":"run_privacy_read",{
    title:exported?"Export your question record":"Read your question privacy",
    description:"Owner-private current-store read using the verified key's explicit history:read scope. No wallet selector or signing. Visibility, defaults and erasure require the interactive web session. Storage admission is required.",
    inputSchema:{id:privacyId.describe("Existing current-store run ID owned by the authenticated key's wallet."),
      ...(exported?{requestId:z.string().uuid().describe("Caller-generated UUID identifying this manual export request in its audit record.")}: {})},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async input=>{
    try {const result=await read(input.id,exported?String(input.requestId):undefined);return {content:[{type:"text" as const,text:JSON.stringify(result)}],structuredContent:result};}
    catch{return {isError:true,content:[{type:"text" as const,text:"Owner read refused or privacy storage unavailable. Use an explicit history:read key. No research or payment was performed."}]};}
  });
}
