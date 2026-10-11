import { z } from "zod";
import { sourceLearningId, validateSourceLearningReport } from "./source-learning-contract";

const input = z.object({ sourceId: sourceLearningId }).strict();
interface Registrar {
  registerTool(name: string, options: { title: string; description: string; inputSchema: typeof input;
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean } },
    handler: (value: unknown) => Promise<{ isError?: boolean; content: Array<{ type: "text"; text: string }> }>): unknown;
}
export function registerSourceLearning(server: Registrar, read: (id: string) => Promise<unknown | null>) {
  server.registerTool("keryx_source_learning", { title: "Recorded source learning sample",
    description: "Read the same bounded observational source/topic record as the public creator page and API. Only write-time independently classified/funded outside observations qualify; owners, unknown and private history are excluded. Source-declared public topics, counts, recorded citation contribution, exact rational average access price, descriptive uncertainty and abrupt-shift flag. No questions, wallets or receipt identifiers. Recorded settlement is not independently revalidated. Live learned selection and exploration are withheld, with zero live exploration allowance. No research, source read, payment, private inspection or policy activation.",
    inputSchema: input, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async value => {
    try {
      const { sourceId } = input.parse(value), result = await read(sourceId);
      if (result === null) throw new Error();
      return { content: [{ type: "text", text: JSON.stringify(validateSourceLearningReport(result, sourceId)) }] };
    } catch { return { isError: true, content: [{ type: "text", text: "Source learning record unavailable. No research or payment was executed." }] }; }
  });
}
