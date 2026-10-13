import { evaluateMandate } from "@/lib/research-mandate/evaluate";
import { mandateExample } from "@/lib/research-mandate/example";
import { mandateErrorResponse, readMandateBody } from "@/lib/research-mandate/http";

export const runtime = "nodejs";
export async function GET() {
  return Response.json({ schema: "urn:keryx:research-mandate:1", executionAuthorized: false,
    basis: "caller-supplied-policy-and-books", contractStatus: "undeployed-candidate",
    instructions: "POST supplied policy, books and proposal for a stateless assessment. Example values are synthetic.",
    example: mandateExample() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  try { return Response.json(evaluateMandate(await readMandateBody(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return mandateErrorResponse(error); }
}
