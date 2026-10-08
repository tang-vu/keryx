import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isObservedBibliographicTask, recognizeBibliographicTask } from "./bibliographic-task-request";

import { frenchArxivTask, frenchDoiTask } from "./fixtures/bibliographic-task-questions";

describe("original caller metadata-only task recognition", () => {
  it.each([
    [frenchArxivTask, "fr", { kind: "arxiv", id: "2005.11401v4" }],
    [frenchDoiTask, "fr", { kind: "doi", doi: "10.1038/s41586-021-03819-2" }],
    ["Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, first author and identifier. Do not summarize research results.", "en", { kind: "doi", doi: "10.1038/s41586-021-03819-2" }],
    ["Hãy tạo một thẻ thư mục cho DOI 10.1038/s41586-021-03819-2: tiêu đề, tác giả đầu tiên và định danh. Không suy ra kết quả nghiên cứu.", "vi", { kind: "doi", doi: "10.1038/s41586-021-03819-2" }],
  ])("binds supported metadata requests to original text and exact identity", (question, language, target) => {
    const task = recognizeBibliographicTask(question as string)!;
    expect(task).not.toBeNull();
    expect(task.request).toEqual({ scope: "metadata-only", language, target });
    expect(task.originalQuestionSha256).toBe(createHash("sha256").update(question as string).digest("hex"));
    expect(task.requestedFields).toEqual(expect.arrayContaining(["title", "firstAuthor", "identifier"]));
    expect(task.requestedAuthorCount).toBe(question === frenchDoiTask ? 3 : 1);
    expect(isObservedBibliographicTask(task)).toBe(true);
    expect(Object.isFrozen(task)).toBe(true);
    expect(Object.isFrozen(task.request.target)).toBe(true);
    expect(isObservedBibliographicTask(JSON.parse(JSON.stringify(task)))).toBe(false);
    expect(isObservedBibliographicTask(new Proxy(task, {}))).toBe(false);
  });

  it.each([
    "Give the title and first author for https://arxiv.org/abs/2005.11401v4.",
    "Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title and identifier.",
    "Do not prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, first author and identifier.",
    'Explain this example: "Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, first author and identifier."',
    "`Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, first author and identifier.`",
    "Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, first author and identifier. Compare the methods and results.",
    "Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, first author and identifier. Read the full paper.",
    "Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, first author and identifier. Recommend adoption in my application.",
    "Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, first author and identifier. Explain why it works.",
    "Prepare a metadata card for https://arxiv.org/pdf/2005.11401v4: title, first author and identifier.",
    "Prepare a metadata card for https://arxiv.org/abs/2005.11401: title, first author and identifier.",
    "Prepare a metadata card for https://arxiv.org/abs/2005.11401v4 and https://arxiv.org/abs/2005.11401v5: title, first author and identifier.",
    "Prepare a metadata card for https://arxiv.org/abs/2005.11401v4?source=other: title, first author and identifier.",
    "Prepare a metadata card for DOI 10.1038/s41586-021-03819-2 at https://example.com/original: title, first author and identifier.",
    "Prepare a metadata card in Spanish for DOI 10.1038/s41586-021-03819-2: title, first author and identifier.",
    "Prepare a metadata card in French and in English for DOI 10.1038/s41586-021-03819-2: title, first author and identifier.",
    "Prepare a metadata card in Japanese for DOI 10.1038/s41586-021-03819-2: title, first author and identifier.",
    "Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, all authors and identifier.",
    "Prepare a metadata card for DOI 10.1038/s41586-021-03819-2: title, first author, five first authors and identifier.",
  ])("leaves absent, ambiguous, quoted, negated, scientific or unsupported tasks on ordinary research: %s", question => {
    expect(recognizeBibliographicTask(question)).toBeNull();
  });

  it("withholds incomplete scans, control bytes and malformed Unicode", () => {
    expect(recognizeBibliographicTask(frenchArxivTask + "x".repeat(30000))).toBeNull();
    expect(recognizeBibliographicTask(frenchArxivTask + "\0")).toBeNull();
    expect(recognizeBibliographicTask(frenchArxivTask + "\uD800")).toBeNull();
  });
});
