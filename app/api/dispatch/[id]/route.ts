/**
 * GET /api/dispatch/[id] — public permalink for a completed dispatch.
 *
 * Returns the full QueryRun (answer, citations, decisions, trace steps,
 * payments). No auth required — permalinks are public by design so judges
 * and external users can review any dispatch without a wallet.
 */

import { NextRequest, NextResponse } from "next/server";
import { historicalDispatchHeaders, resolveDispatch } from "@/lib/history/read-dispatch";
import { publicQueryRun } from "@/lib/research/public-query-run";
import { requestPrivacyActor } from "@/lib/run-privacy/auth";
import { getDb } from "@/lib/db";
import { privateRunResponse } from "@/lib/run-claims/private-response";
export const dynamic="force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  try {
    const db=await getDb(),actor=await requestPrivacyActor(_req,db);if(actor instanceof Response)return actor;
    const dispatch = await resolveDispatch(id,db,actor);
    if (!dispatch) {
      return privateRunResponse(NextResponse.json({ error: "not found" }, { status: 404 }));
    }
    return privateRunResponse(NextResponse.json({
      ...publicQueryRun(dispatch.run),
      ...(dispatch.archive ? { archive: dispatch.archive } : {}),
    }, { headers: historicalDispatchHeaders(dispatch.archive) }));
  } catch (err) {
    void err;
    return privateRunResponse(NextResponse.json({ error:"dispatch unavailable" }, { status: 503 }));
  }
}
