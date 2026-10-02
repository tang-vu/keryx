import type { NextRequest } from "next/server";
import type { KeryxDB } from "../db/keryx-db";
import type { Source, SourceItem } from "../types";
import { approvedPaperState } from "../db/scholarly-rights";
import { assertPaperManifest, assertPaperRegistry, assertPaperVersion, verifyRetainedPaperState } from "./rights-authority";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import { contentBodyHash } from "../sources/content-receipt";

/** Sticky enrollment is checked even while rejected/revoked. Legacy sources retain their policy. */
export async function paperPaidGate(db: KeryxDB, source: Source, req: NextRequest,
  intent: { kind: "fetch" | "citation"; payee: string; amountMicros: number; item?: SourceItem; bundle?: boolean },
): Promise<Response | null> {
  try {
    const state = await db.getPaperState?.(source.id);
    if (!state) {
      const marked = source.scholarlyEnrolled || db.getPaperState && (await db.getSource(source.id))?.scholarlyEnrolled;
      return marked ? Response.json({ error: "Scholarly rights are draft or backend unavailable" }, { status: db.getPaperState ? 409 : 503 }) : null;
    }
    if (intent.bundle) return Response.json({ error: "Scholarly manuscripts require the exact-version article endpoint" }, { status: 409 });
    const items = await db.getItems(source.id), item = intent.item ?? items[0];
    const header = req.headers.get("payment-signature");
    if (!header) {
      approvedPaperState(state);
      await verifyRetainedPaperState(state);
      assertPaperVersion(state.submission.declaration, source, items);
      await assertPaperManifest(state.submission.declaration, items[0]);
      await assertPaperRegistry(state.submission.declaration, source);
      if (intent.payee.toLowerCase() !== state.submission.declaration.recipient)
        throw new Error("Payee differs from reviewed scholarly recipient");
      return null;
    }
    if (header.length > 16_384) throw new Error("Payment header exceeds pilot bounds");
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const authorization = (decoded?.payload ?? decoded)?.authorization;
    if (!authorization || !/^0x[0-9a-fA-F]{64}$/.test(authorization.nonce)) throw new Error("Original browser authorization is required");
    const admitted = await db.getPaperAdmission?.(authorization.nonce.toLowerCase());
    // An arbitrary legacy nonce never acquires scholarly permission retrospectively.
    if (!admitted || admitted.sourceId !== source.id || admitted.kind !== intent.kind
      || admitted.payee !== intent.payee.toLowerCase() || admitted.amountMicros !== intent.amountMicros
      || admitted.payer !== String(authorization.from).toLowerCase() || admitted.payee !== String(authorization.to).toLowerCase()
      || String(authorization.value) !== String(admitted.amountMicros) || !item || items.length !== 1
      || item.id !== admitted.itemId || sourceItemContentVersion(item) !== admitted.contentVersion
      || item.manifest?.id !== admitted.manifestId || item.bodyHash?.toLowerCase() !== admitted.bodyHash)
      throw new Error("Payment is not the retained scholarly browser admission for this exact version");
    // Revocation prevents new admissions. An already exposed authorization keeps its original approval,
    // and still needs compatible fresh registry terms and unchanged bytes before seller settlement.
    await assertPaperRegistry({ ...state.submission.declaration,
      sourceId: admitted.sourceId, registry: admitted.registry, onchainId: admitted.onchainId,
      creator: admitted.creator, recipient: admitted.payee, priceMicros: admitted.priceMicros }, source);
    return null;
  } catch {
    return Response.json({ error: "Scholarly rights or exact-version browser admission unavailable; no new payment is accepted" }, { status: 409 });
  }
}

/** Only actual identical public bytes qualify; DOI metadata alone never proves a free full copy. */
export async function paperDuplicatesPublicBody(db: KeryxDB, source: Source, publicTexts: string[]): Promise<boolean> {
  try {
    const state = await db.getPaperState?.(source.id);
    return !!state && publicTexts.some(text => text.trim() && contentBodyHash(text) === state.submission.declaration.bodyHash);
  } catch { return true; }
}

/** Applied before discovery/cache reads; a cached body cannot reopen suspended admissions. */
export async function paperCanResearch(db: KeryxDB, source: Source, optedIn: boolean): Promise<boolean> {
  try {
    const state = await db.getPaperState?.(source.id);
    if (!state) return !source.scholarlyEnrolled && !(db.getPaperState && (await db.getSource(source.id))?.scholarlyEnrolled);
    if (!optedIn) return false;
    approvedPaperState(state);
    await verifyRetainedPaperState(state);
    const currentSource = await db.getSource(source.id);
    if (!currentSource) return false;
    const items = await db.getItems(source.id);
    assertPaperVersion(state.submission.declaration, currentSource, items);
    await assertPaperManifest(state.submission.declaration, items[0]);
    await assertPaperRegistry(state.submission.declaration, currentSource);
    const current = await db.getPaperState?.(source.id);
    if (!current || current.declarationId !== state.declarationId || current.decisionId !== state.decisionId) return false;
    approvedPaperState(current);
    return true;
  } catch { return false; }
}
