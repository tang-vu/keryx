import { creatorOwnerWithdrawalHttp } from "@/lib/gateway/creator-owner-withdrawal-http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export function POST(request:Request) {return creatorOwnerWithdrawalHttp("complete",request);}
