# Evidence matrix Markdown download

The dispatch evidence matrix can download the same inspectable rows as its CSV.
Each recorded excerpt stays indented verbatim. A target with no inspectable
excerpt keeps that status and gains no quote. Overlong, uncited and rejected
excerpts stay out, matching the CSV. Status words stay the existing English
inspection labels. The file does not judge whether a target is true.

Stored answers, citations, payments and the CSV download are unchanged. The full
research-report Markdown remains a separate export. Runtime delivery stays with
the existing release owner.

The helper lives in `lib/research/evidence-matrix-markdown.ts`. The button label
lives in the evidence-matrix-export catalogue. `lib/research/evidence-matrix.ts`
and `locales/en/reports.ts` stay as they are, because the controlled
paying-source study pins those files and release 85 still holds the study fixtures.
