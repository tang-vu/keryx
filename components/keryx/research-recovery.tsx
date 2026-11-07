"use client";

import { useEffect, useState } from "react";
import { UiText } from "@/lib/i18n/ui-copy";
import type { RunVisibility } from "@/lib/run-privacy/contracts";
import { researchRecoveryCopy } from "@/lib/research/research-recovery-copy";
import { ResearchChat } from "./research-chat";

/** Reopen in memory only. No question in a URL/storage and no request until Ask. */
export function ResearchRecovery({ question, budget, parentId, visibility, expectedWallet, initiallyOpened = false, preparedFollowUp, onPreparationReadyChange }: {
  question: string; budget: number; parentId: string; visibility: RunVisibility; expectedWallet: string | null; initiallyOpened?: boolean;
  preparedFollowUp?: { id: number; question: string };
  onPreparationReadyChange?: (ready: boolean) => void;
}) {
  const [opened, setOpened] = useState(initiallyOpened);
  const showComposer = opened || !!preparedFollowUp;
  useEffect(() => {
    if (!showComposer) onPreparationReadyChange?.(true);
  }, [showComposer, onPreparationReadyChange]);
  return <section className="my-6 border border-line bg-paper p-4" data-testid="research-recovery">
    <p className="mb-3 text-sm text-ink-2"><UiText source={researchRecoveryCopy.review} /></p>
    {!showComposer && <button type="button" className="min-h-11 border border-line px-4 py-2 font-mono text-xs" onClick={() => setOpened(true)}>
      <UiText source={researchRecoveryCopy.reopen} />
    </button>}
    {showComposer && <ResearchChat initialRequest={{ question: preparedFollowUp?.question ?? question, budget, parentId, visibility, expectedWallet }}
      preparedFollowUp={preparedFollowUp} onPreparationReadyChange={onPreparationReadyChange} />}
  </section>;
}
