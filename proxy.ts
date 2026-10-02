import { NextResponse, type NextRequest } from "next/server";
import { deploymentIngressDenied } from "./lib/mainnet-pilot/ingress-mode";

export function proxy(request: NextRequest) {
  if (deploymentIngressDenied(request))
    return NextResponse.json({ error: "unsupported_pilot_surface" }, { status: 403 });
  return NextResponse.next();
}
export const config = { matcher: ["/api/:path*", "/mcp/:path*"] };
