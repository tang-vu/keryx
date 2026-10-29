"use client";

import { useId, useState } from "react";
import { UiText } from "@/lib/i18n/ui-copy";
import { uiPreferenceCopy } from "@/locales/en/ui-preference";
import { answerLanguageInstructions } from "@/shared/i18n/answer-language-instructions";

/** Manual, question-adjacent guidance. Opening it changes only this disclosure. */
export function AnswerLanguageHelp() {
  const id = useId(), [open, setOpen] = useState(false);
  return <div className="text-xs leading-relaxed text-ink-2" data-answer-language-help>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}
      className="block min-h-11 text-left underline decoration-ink-3 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
      <UiText source={uiPreferenceCopy("answerLanguageTitle")} namespaces={["ui-preference"]} />
    </button>
    <div id={id} hidden={!open} className="pb-2">
      <p><UiText source={uiPreferenceCopy("answerLanguageBody")} namespaces={["ui-preference"]} /></p>
      <p id={`${id}-examples`} className="mt-2 font-semibold">
        <UiText source={uiPreferenceCopy("answerLanguageExamples")} namespaces={["ui-preference"]} />
      </p>
      <ul aria-labelledby={`${id}-examples`} className="mt-1 space-y-1">
        {answerLanguageInstructions.map(example => <li key={example.language} className="flex min-w-0 flex-wrap gap-x-2">
          <span lang={example.language}>{example.name}</span>
          <code lang={example.language} className="break-words font-mono">{example.instruction}</code>
        </li>)}
      </ul>
    </div>
  </div>;
}
