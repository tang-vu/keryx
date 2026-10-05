import { authJson } from "@/lib/auth-challenge";
import { circleWalletReady } from "@/lib/circle-wallet-server";
export const runtime = "nodejs";
export async function GET() { return authJson({ available: circleWalletReady() }); }
