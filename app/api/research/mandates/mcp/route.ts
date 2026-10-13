import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMandateMcpServer } from "@/lib/research-mandate/mcp";
import { mandateErrorResponse, readMandateBody } from "@/lib/research-mandate/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  let server: ReturnType<typeof createMandateMcpServer> | undefined;
  try {
    const parsedBody = await readMandateBody(request);
    server = createMandateMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, sessionIdGenerator: undefined });
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });
    // JSON-only stateless responses are complete before cleanup. No SSE lifetime is detached.
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers); headers.set("Cache-Control", "no-store");
    return new Response(body.byteLength ? body : null, { status: response.status, headers });
  } catch (error) { return mandateErrorResponse(error); }
  finally { await server?.close(); }
}
