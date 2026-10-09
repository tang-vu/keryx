import type { UiLocale } from "./locales";

/** English source keys. Payment/legal prose remains in its separate review gate. */
export const englishMessages = Object.freeze({
  "navigation.home": "Home",
  "navigation.archive": "The archive",
  "navigation.newDispatch": "New dispatch",
  "locale.label": "Interface language",
  "report.question": "Question: {question}",
  "report.citedSources.one": "{count} source cited",
  "report.citedSources.other": "{count} sources cited",
  "format.unavailable": "Unavailable",
  "researchEntry.ask": "Ask Keryx",
  "researchEntry.network": "USDC on {network}",
  "researchEntry.question": "What do you want to know?",
  "researchEntry.placeholder": "Ask a question worth reading for...",
  "researchEntry.keyboardHint": "Enter for a new line · Ctrl/⌘ + Enter to ask",
  "researchEntry.metadataLookup": "Look up free paper metadata",
  "researchEntry.metadataLookupLabel": "Look up free paper metadata: title, authors or DOI",
  "researchEntry.depth": "Research depth",
  "researchEntry.quick": "quick",
  "researchEntry.deep": "deep",
  "researchEntry.quickHint": "Quick: up to 2 focused reads.",
  "researchEntry.deepHint": "Deep: up to 4 reads, including marketplace discovery and a coverage check.",
  "researchEntry.sourceCap": "Source cap: {amount} USDC · {payer}",
  "researchEntry.treasuryPayer": "Keryx pays",
  "researchEntry.sessionPayer": "Your research budget",
  "researchEntry.expiredPayer": "Budget expired",
  "researchEntry.pausedPayer": "Budget paused",
  "researchEntry.researching": "Researching...",
  "researchEntry.paused": "Research paused",
  "researchEntry.checking": "Checking research availability…",
  "researchEntry.savedReports": "My saved reports",
  "researchEntry.checkAvailability": "Check availability",
  "researchEntry.sessionNotice": "Your research budget pays on {network}. This question can use up to {amount} USDC; your remaining total also applies.",
  "researchEntry.unavailableSessionNotice": "Session status unavailable. Recover your funded session below before another question.",
  "researchEntry.expiredSessionNotice": "Session expired. Recover it below before another wallet funded question.",
  "researchEntry.sponsoredNotice": "Sponsored trial on {network}. No wallet or deposit required. Usage and spending limits apply.",
  "researchEntry.scholarly": "Search scholarly papers (Crossref and arXiv)",
  "researchEntry.scholarlyNotice": "Sends your question to scholarly repositories. DOI lookup works when a DOI is in the question. Public papers cost no source USDC; unavailable papers and abstract-only reads stay visible.",
  "researchEntry.paidScholarly": "Include reviewed paid manuscripts (experimental testnet rights protocol)",
  "researchEntry.paidScholarlyMainnetNotice": "Paid manuscript rights are not yet available on mainnet. Ordinary registered articles remain available.",
  "researchEntry.paidScholarlyNotice": "Requires your funded browser session. Uses the question budget for access and supported citation rewards. Public scholarly references stay free; only approved exact versions can be paid.",
  "researchEntry.budgetAndModel": "Budget and model: ${amount} USDC",
  "researchEntry.maximumBudget": "Maximum budget",
  "researchEntry.maximumBudgetLabel": "Maximum budget in USDC",
  "researchEntry.budgetNotice": "The agent cannot spend more than this amount on one question. Choose 0 for free sources without source purchases or creator rewards. Model and search costs remain separate.",
  "researchEntry.model": "AI model",
  "researchEntry.defaultModelNote": "Default reasoning model",
  "researchEntry.defaultModel": "Default: DeepSeek",
  "researchEntry.searchNotice": "Research may search the public web; your question is sent to our search provider. The USDC source budget is separate from model and search operating costs.",
  "researchEntry.examplesLabel": "Example questions",
  "researchEntry.sqliteExample": "Compare SQLite WAL and rollback journals",
  "researchEntry.educationExample": "Research children's educational video ideas",
  "ledgerHistory.inspectWallet": "Inspect original testnet wallet {wallet}",
  "ledgerHistory.paymentCounts": "{cites} cites · {payments} payments",
  "ledgerHistory.creatorLeaderboard": "Testnet creator leaderboard",
  "ledgerHistory.downloadCreators": "Download creator data →",
  "ledgerHistory.rankingNotice": "Ranked by settled access and citation payments to each original source and wallet. Historical listings do not establish current publisher control.",
  "ledgerHistory.allEntries": "Show all {count} source / wallet entries",
  "ledgerHistory.emptyCreators": "No settled creator payments in this snapshot.",
  "ledgerHistory.evidenceLabel": "Historical Arc testnet evidence",
  "ledgerHistory.trackRecord": "The track record",
  "ledgerHistory.title": "Arc testnet history",
  "ledgerHistory.browseQuestions": "Browse all old questions →",
  "ledgerHistory.period": "Recorded reading and creator payments from {from} to {to}. Original testnet evidence is retained alongside current mainnet activity.",
  "ledgerHistory.recordedQuestions": "Recorded questions",
  "ledgerHistory.settledCreatorPayments": "Settled creator payments",
  "ledgerHistory.settledToCreators": "Settled to creator wallets",
  "ledgerHistory.creatorWallets": "Creator wallets paid",
  "ledgerHistory.historicalNotice": "Testnet USDC, separate from mainnet. Includes owner-operated activity; these totals do not establish independent customers or event-period growth.",
  "ledgerHistory.creatorUnavailable": "Testnet creator leaderboard temporarily unavailable.",
  "ledgerHistory.retry": "Open history to retry.",
  "ledgerHistory.inspectTotals": "Inspect archived totals and channels",
  "ledgerHistory.paymentRecordsSuffix": " payment records",
  "ledgerHistory.serviceReceipts": "Service receipts (separate from creator payments)",
  "ledgerHistory.settledRecordsSuffix": " records · settled amount",
  "ledgerHistory.unknownChannel": "Unknown channel",
  "ledgerHistory.questionsSuffix": " questions",
  "ledgerHistory.snapshotNotice": "Snapshot captured {capturedAt}. Settlement states are frozen at capture time. Wallets and channels are recorded identities, not independent people.",
  "ledgerHistory.archiveData": "Archive data",
  "ledgerHistory.eventEvidence": "Event-period evidence",
  "ledger.title": "Reading activity & creator rewards",
  "ledger.introduction": "Follow the questions, explore the sources, and see what reached creator wallets. Browse the retained testnet track record and current mainnet activity, each with its original payment proof.",
  "ledger.sectionsLabel": "Ledger sections",
  "ledger.testnetTrackRecord": "Testnet track record",
  "ledger.activity": "{network} activity",
  "ledger.currentCreators": "Current creator rewards",
  "ledger.paymentEvidence": "Payment evidence",
  "ledger.currentActivityLabel": "Current network activity",
  "ledger.creatorLeaderboard": "{network} creator leaderboard",
} as const);
export type MessageKey = keyof typeof englishMessages;
type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Tail}` ? Name | Placeholders<Tail> : never;
type Parameters<K extends MessageKey> = Record<Placeholders<typeof englishMessages[K]>, string | number>;
type MessageArguments<K extends MessageKey> = [Placeholders<typeof englishMessages[K]>] extends [never] ? [] : [Parameters<K>];
export type MessageCatalogue = Partial<Record<MessageKey, string>>;
export type MissingMessageReporter = (locale: UiLocale, key: MessageKey) => void;

function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]))].sort();
}

/** Used by CI/review and by an eventual selected-locale loader; no implicit approval. */
export function validateMessageCatalogue(catalogue: MessageCatalogue): { missing: MessageKey[]; invalid: string[] } {
  const keys = Object.keys(englishMessages) as MessageKey[];
  const invalid = Object.keys(catalogue).filter(key => !Object.hasOwn(englishMessages, key));
  const missing = keys.filter(key => !Object.hasOwn(catalogue, key) || catalogue[key] === undefined);
  for (const key of keys) {
    const text = catalogue[key];
    if (text === undefined) continue;
    if (typeof text !== "string" || !text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ||
      JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(englishMessages[key]))) invalid.push(key);
  }
  return { missing, invalid };
}

/** Pass only the selected catalogue to a client. Missing translations render English. */
export function createMessages(locale: UiLocale, catalogue: MessageCatalogue = {}, reportMissing?: MissingMessageReporter) {
  const descriptors = Object.getOwnPropertyDescriptors(catalogue);
  if (Reflect.ownKeys(catalogue).some(key => typeof key !== "string") ||
    Object.values(descriptors).some(descriptor => !("value" in descriptor))) throw new Error("Invalid message catalogue properties");
  const selected = Object.freeze(Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]))) as MessageCatalogue;
  const checked = validateMessageCatalogue(selected);
  if (checked.invalid.length) throw new Error(`Invalid message catalogue: ${checked.invalid.join(", ")}`);
  return function message<K extends MessageKey>(key: K, ...args: MessageArguments<K>): string {
    if (!Object.hasOwn(englishMessages, key)) throw new Error("Unknown English source message");
    const translated = Object.hasOwn(selected, key) ? selected[key] : undefined;
    if (translated === undefined && locale !== "en") reportMissing?.(locale, key);
    const text = translated ?? englishMessages[key];
    const parameters = args[0] as Record<string, string | number> | undefined;
    return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, name: string) => {
      if (!parameters || !Object.hasOwn(parameters, name) || !["string", "number"].includes(typeof parameters[name])) {
        throw new Error(`Missing message parameter: ${name}`);
      }
      return String(parameters[name]);
    });
  };
}
