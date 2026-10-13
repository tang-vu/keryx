import { createHash } from "node:crypto";
import { z } from "zod";
import { isConfiguredSameOrigin } from "../auth-origin";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { literatureWorkspaceSchema } from "../papers/literature-workspace";
import { readBoundedRequestJson } from "../read-bounded-request-json";
import { boundedPortableCopy } from "./bounded-portable-json";
import { evidenceDraftWorkspace } from "./evidence-draft";
import { COMPLETED_READ_CAPABILITY, CompletedReadRefusal, completedReadSelectionSchema,
  loadCompletedEvidenceDraft, MAX_COMPLETED_SNAPSHOT_BYTES, type CompletedReadContext } from "./completed-evidence-draft";

const owner = z.string().regex(/^0x[a-f0-9]{40}$/).refine(value => !/^0x0{40}$/.test(value));
const inputSchema = z.object({ version: z.literal(1), id: z.string().regex(/^prv_[a-f0-9]{64}$/),
  workspace: literatureWorkspaceSchema }).strict();
// Only retained identity fields enter the selector. The accepted adapter checks
// the complete ledger, intent, execution and repeated immutable capture below.
const source = completedReadSelectionSchema.shape.sources.element;
const projection = z.object({ id: inputSchema.shape.id, asker: owner,
  question: completedReadSelectionSchema.shape.question, budget: completedReadSelectionSchema.shape.budget,
  researchMode: completedReadSelectionSchema.shape.researchMode,
  citations: z.array(source.passthrough()).max(64), evidence: z.array(source.passthrough()).max(256).optional() });
const DEADLINE_MS = 10000;
async function beforeDeadline<T>(until: number, operation: () => Promise<T>): Promise<T> {
  const remaining = until - Date.now();
  if (remaining <= 0) throw new CompletedReadRefusal("storage");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CompletedReadRefusal("storage")), remaining);
  })]); } finally { clearTimeout(timer); }
}

/** Explicit existing job lookup only; no inventory, public projection, source
 * read, fallback or write. The digest binds the exact retained UTF-8 bytes. */
export async function loadCompletedEvidenceDraftSelection(context: CompletedReadContext, value: unknown,
  until = Date.now() + DEADLINE_MS) {
  const input = inputSchema.parse(boundedPortableCopy(value, 65536));
  const wallet = owner.parse(context.wallet), workspace = evidenceDraftWorkspace(input.workspace);
  if (!workspace.entries.length) throw new CompletedReadRefusal("changed");
  for (const method of ["getPrivateResearchResult", "getPrivateResearchIntent", "getPrivateResearchExecution", "getPrivateResearchInterruption"] as const)
    if (typeof context.db[method] !== "function") throw new CompletedReadRefusal("storage");
  try {
    const saved = await beforeDeadline(until, async () => {
      try { return await context.db.getPrivateResearchResult(input.id, wallet); }
      catch { throw new CompletedReadRefusal("storage"); }
    });
    if (!saved || saved.id !== input.id || saved.format !== "query-run-v1") throw new CompletedReadRefusal("changed");
    // Capture scalars before any further await; never reserialize JSON for hashing.
    const { serializedRun, savedAt } = saved;
    if (typeof serializedRun !== "string" || serializedRun.length > MAX_COMPLETED_SNAPSHOT_BYTES
      || !isWellFormedUtf16(serializedRun) || new TextEncoder().encode(serializedRun).length > MAX_COMPLETED_SNAPSHOT_BYTES)
      throw new CompletedReadRefusal("changed");
    const run = projection.parse(boundedPortableCopy(JSON.parse(serializedRun), MAX_COMPLETED_SNAPSHOT_BYTES));
    if (run.id !== input.id || run.asker !== wallet) throw new CompletedReadRefusal("changed");
    const included = new Set(workspace.entries.map(row => row.paper.url));
    const sources = new Map<string, z.infer<typeof source>>();
    for (const row of [...run.citations, ...(run.evidence ?? [])]) {
      // Missing URL/item/version refuses the whole projection above, even when
      // a paper cannot be identified. Nothing is inferred from titles or drafts.
      if (!included.has(row.itemUrl)) continue;
      const identity = source.parse({ sourceId: row.sourceId, itemId: row.itemId,
        itemUrl: row.itemUrl, contentVersion: row.contentVersion });
      const prior = sources.get(row.itemUrl);
      if (prior && JSON.stringify(prior) !== JSON.stringify(identity)) throw new CompletedReadRefusal("changed");
      sources.set(row.itemUrl, identity);
    }
    const selection = completedReadSelectionSchema.parse({ id: run.id, savedAt,
      snapshotSha256: `sha256:${createHash("sha256").update(serializedRun, "utf8").digest("hex")}`,
      question: run.question, budget: run.budget, researchMode: run.researchMode, sources: [...sources.values()] });
    // Reuse the accepted owner/completion/identity/provenance guards, including
    // two saved captures. A change since the initial byte capture refuses selection.
    await beforeDeadline(until, () => loadCompletedEvidenceDraft(context, {
      version: 1, capability: COMPLETED_READ_CAPABILITY, baseUrl: context.baseUrl, network: context.network, selection, workspace,
    }));
    return { format: "completed-evidence-draft-selection-v1" as const, wallet, capability: COMPLETED_READ_CAPABILITY,
      baseUrl: context.baseUrl, network: context.network, selection };
  } catch (error) {
    if (error instanceof CompletedReadRefusal) throw error;
    throw new CompletedReadRefusal("changed");
  }
}
export type CompletedEvidenceDraftSelectionPacket = Awaited<ReturnType<typeof loadCompletedEvidenceDraftSelection>>;

const headers = { "Cache-Control": "private, no-store", "Vary": "Authorization, Cookie, Origin, X-Keryx-Expected-Owner",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const json = (value: unknown, status: number) => Response.json(value, { status, headers });
export function createCompletedEvidenceDraftSelectionRoute(options: {
  baseUrl: string; network: string;
  account: () => Promise<Pick<CompletedReadContext, "db" | "wallet"> | Response>;
}) {
  const { baseUrl, network, account } = options;
  return async (request: Request) => {
    const until = Date.now() + DEADLINE_MS;
    try {
      if (request.method !== "POST" || new URL(request.url).search || new URL(request.url).hash)
        return json({ error: "invalid_completed_selection_request" }, 400);
      if (request.headers.has("authorization")) return json({ error: "account_session_required" }, 401);
      if (!isConfiguredSameOrigin(request, baseUrl)) return json({ error: "same_origin_required" }, 403);
      const expected = owner.safeParse(request.headers.get("x-keryx-expected-owner"));
      if (!expected.success) return json({ error: "expected_owner_required" }, 403);
      const context = await beforeDeadline(until, account);
      if (context instanceof Response) return json({ error: context.status === 401 ? "account_session_required"
        : "completed_selection_authentication_unavailable" }, context.status === 401 ? 401 : 503);
      if (context.wallet !== expected.data) return json({ error: "owner_changed" }, 403);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
        return json({ error: "invalid_completed_selection_request" }, 400);
      let input: unknown;
      try { input = inputSchema.parse(await beforeDeadline(until, () => readBoundedRequestJson(request, 65536))); }
      catch { return json({ error: "invalid_completed_selection_request" }, 400); }
      const packet = await loadCompletedEvidenceDraftSelection({ ...context, baseUrl, network }, input, until);
      // Authenticate again before disclosing metadata. No session/API-key/body
      // selector can switch the owner or adapter during a retained read.
      const current = await beforeDeadline(until, account);
      if (current instanceof Response) return json({ error: "owner_changed" }, current.status === 401 ? 401 : 503);
      if (current.wallet !== expected.data || current.db !== context.db) return json({ error: "owner_changed" }, 403);
      if (new TextEncoder().encode(JSON.stringify(packet)).length > 65536) throw new CompletedReadRefusal("changed");
      return json(packet, 200);
    } catch (error) {
      return json({ error: error instanceof CompletedReadRefusal && error.kind === "changed"
        ? "completed_selection_unavailable_or_changed" : "completed_selection_storage_unavailable" },
      error instanceof CompletedReadRefusal && error.kind === "changed" ? 409 : 503);
    }
  };
}
