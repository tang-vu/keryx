import { withdrawalHttpRoute } from "@/lib/gateway/withdrawal-http-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(request: Request) {
  return withdrawalHttpRoute("submit", request);
}
