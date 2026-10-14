import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  PRIVATE_JOB_HISTORY_BOUNDS as B, parsePrivateJobHistoryInput, privateJobHistoryInputSchema,
  privateJobHistoryDetailInputSchema, privateJobHistoryPageSchema, privateJobHistoryDetailSchema,
  privateJobHistoryExportSchema,
  type PrivateJobHistoryInput, type PrivateJobHistoryPage, type PrivateJobHistoryDetail, type PrivateJobHistoryExport,
} from "./private-job-history-contract";
import { guardPrivateJobHistoryPage, guardPrivateJobHistoryDetail, guardPrivateJobHistoryExport,
  PRIVATE_JOB_HISTORY_REFUSAL } from "./private-job-history-client";

export interface PrivateJobHistoryTools {
  list(input: PrivateJobHistoryInput, options?: { signal?: AbortSignal }): Promise<PrivateJobHistoryPage>;
  detail(input: { id: string }, options?: { signal?: AbortSignal }): Promise<PrivateJobHistoryDetail | null>;
  export(input: PrivateJobHistoryInput, options?: { signal?: AbortSignal }): Promise<PrivateJobHistoryExport>;
  /** Synchronous lifetime fence immediately before output, in addition to async admission. */
  current?(): void;
}
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const description = "Private data for this authenticated caller only. Exact-payer completed private jobs in the current store; explicit history:read required. Bounded scan/continuation, unknown provenance and NULL own spend/creator settlement remain explicit. No wallet selector, public report/share link, model prompt, research, source fetch, signer, purchase or mutation authority.";
const refusal = () => ({ isError: true, content: [{ type: "text" as const, text: PRIVATE_JOB_HISTORY_REFUSAL }] });
// The pinned SDK normalizes object schemas for discovery/output, not ZodEffects.
// Expose the SAME underlying object fields; callbacks retain every shared refinement.
// Catch only to throw a constant error, so SDK enum/regex failures cannot echo tokens
// or cursors. No invalid value is defaulted/accepted, and JSON Schema keeps its bounds.
const listInput = privateJobHistoryInputSchema.innerType();
const detailInput = privateJobHistoryDetailInputSchema;
function secretFreeInput<T extends z.ZodRawShape>(shape: T) {
  const guarded = Object.fromEntries(Object.entries(shape).map(([name, schema]) => {
    const field = schema.catch(() => { throw new Error(PRIVATE_JOB_HISTORY_REFUSAL); });
    // The converter probes optionality by parsing undefined; retain original required
    // fields instead of letting a throwing catch make the required detail ID optional.
    field.isOptional = () => schema.isOptional();
    return [name, field];
  }));
  return z.object(guarded).strict(PRIVATE_JOB_HISTORY_REFUSAL);
}

/** Same shared schemas for remote and stdio; callbacks supply existing verified authority. */
export function registerPrivateJobHistoryTools(server: McpServer, tools: PrivateJobHistoryTools) {
  server.registerTool("history_private_jobs_list", {
    title: "List your completed private jobs", description, inputSchema: secretFreeInput(listInput.shape),
    outputSchema: privateJobHistoryPageSchema.innerType(), annotations,
  }, async (raw, extra) => {
    try {
      extra.signal.throwIfAborted();
      const input = parsePrivateJobHistoryInput(raw);
      const value = guardPrivateJobHistoryPage(await tools.list(input, { signal: extra.signal }), input);
      tools.current?.();
      extra.signal.throwIfAborted();
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
    } catch { return refusal(); }
  });
  server.registerTool("history_private_jobs_detail", {
    title: "Read one of your completed private results", description,
    inputSchema: secretFreeInput(detailInput.shape), outputSchema: privateJobHistoryDetailSchema.innerType(), annotations,
  }, async (raw, extra) => {
    try {
      extra.signal.throwIfAborted();
      const input = privateJobHistoryDetailInputSchema.parse(raw);
      const value = guardPrivateJobHistoryDetail(await tools.detail(input, { signal: extra.signal }), input.id);
      tools.current?.();
      extra.signal.throwIfAborted();
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
    } catch { return refusal(); }
  });
  server.registerTool("history_private_jobs_export", {
    title: "Export your private job metadata", description: description + " Manual finite JSON metadata export only; complete/truncated and continuation are returned. Result bodies are excluded.",
    inputSchema: secretFreeInput(listInput.shape), outputSchema: privateJobHistoryExportSchema.innerType(), annotations,
  }, async (raw, extra) => {
    try {
      extra.signal.throwIfAborted();
      const input = parsePrivateJobHistoryInput(raw);
      const value = guardPrivateJobHistoryExport(await tools.export(input, { signal: extra.signal }), input);
      tools.current?.();
      extra.signal.throwIfAborted();
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
    } catch { return refusal(); }
  });
}

/** Structural request-local access only. The HTTP caller owns the original verifier,
 * including live key ID/owner/scope/revocation checks. This adds no credential source. */
export interface PrivateJobHistoryAccess {
  actor?: string; historyScopes?: readonly string[]; keyId?: string;
  revalidateHistoryAccess?: () => Promise<void>; signal?: AbortSignal;
}
export function createPrivateJobHistoryRead<DB>(access: PrivateJobHistoryAccess, getDb: () => Promise<DB>) {
  const actor = access.actor, scopes = access.historyScopes, scopeSnapshot = scopes?.join("\0"), keyId = access.keyId;
  const revalidate = access.revalidateHistoryAccess, signal = access.signal;
  const current = () => {
    if (!actor || !/^0x[a-f0-9]{40}$/.test(actor) || !scopes?.includes("history:read") || !revalidate
      || access.actor !== actor || access.historyScopes !== scopes || scopes.join("\0") !== scopeSnapshot
      || access.revalidateHistoryAccess !== revalidate || access.keyId !== keyId || access.signal !== signal || signal?.aborted) {
      throw new Error(PRIVATE_JOB_HISTORY_REFUSAL);
    }
  };
  return { current, async read<T>(read: (db: DB, owner: string, options: { signal: AbortSignal; deadline: number }) => Promise<T>,
    exporting = false, callSignal?: AbortSignal): Promise<T> {
    current();
    if (callSignal?.aborted) throw new Error(PRIVATE_JOB_HISTORY_REFUSAL);
    const controller = new AbortController(), cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    callSignal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted || callSignal?.aborted) cancel();
    const deadline = Date.now() + (exporting ? B.exportMs : B.readMs);
    let rejectStop!: (error: Error) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    void stopped.catch(() => undefined);
    const stop = () => rejectStop(new Error(PRIVATE_JOB_HISTORY_REFUSAL));
    controller.signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(cancel, Math.max(0, deadline - Date.now()));
    const check = () => { current(); if (controller.signal.aborted || Date.now() >= deadline) throw new Error(PRIVATE_JOB_HISTORY_REFUSAL); };
    const wait = async <V>(fn: () => Promise<V>) => {
      check();
      const value = await Promise.race([Promise.resolve().then(() => { check(); return fn(); }), stopped]);
      check(); return value;
    };
    try {
      // Always invoke the captured ORIGINAL verifier, never a replacement installed during IO.
      await wait(() => revalidate!.call(access));
      const db = await wait(getDb);
      await wait(() => revalidate!.call(access));
      const value = await wait(() => read(db, actor!, { signal: controller.signal, deadline }));
      await wait(() => revalidate!.call(access));
      check(); return value;
    } catch { throw new Error(PRIVATE_JOB_HISTORY_REFUSAL); }
    finally {
      clearTimeout(timer); signal?.removeEventListener("abort", cancel); callSignal?.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", stop); controller.abort();
    }
  } };
}
