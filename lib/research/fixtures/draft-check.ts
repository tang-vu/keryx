import type { DraftCheckRequest } from "../draft-check";

/** Synthetic passage, references and source text; no real paper or reader is represented. */
export function draftCheckFixture(): DraftCheckRequest {
  return { version: 1, scope: "private-draft-check",
    passage: "Retrieval improves factual accuracy on open-domain questions [1]. Dropout reduces overfitting in deep networks [2]. Our own pilot agrees.",
    references: { format: "list", text: "[1] Lewis, P. (2020). Synthetic retrieval study. https://doi.org/10.5555/synthetic.1\n[2] Smith, N. (2014). Synthetic dropout study. https://example.org/synthetic-dropout" },
    sources: [{ reference: "ref1", coverage: "partial", text: "Background is omitted here. We show that retrieval improves factual accuracy on open-domain questions.\nLatency increased." }] };
}
