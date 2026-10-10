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
  "account.eyebrow": "Your Keryx account",
  "account.signInTitle": "Sign in to {brand}",
  "account.signInBrand": "Keryx.",
  "account.introduction": "Sign in to research, publish sources, and manage your account. Your wallet holds your USDC; you choose how much the agent can spend.",
  "account.created": "Account created",
  "account.signedIn": "Signed in to Keryx",
  "account.role": "Role: {role}",
  "account.signInFailed": "Sign-in failed",
  "account.signedOut": "Signed out",
  "account.signOutUnconfirmed": "Sign-out could not be confirmed. Please retry.",
  "account.checkingReturn": "Checking sign-in return context...",
  "account.step": "Step {number}",
  "account.wrongNetwork": "Wrong network",
  "account.networkInstruction": "Keryx runs on {network} (chainId {chainId}). Switch to continue.",
  "account.switchNetwork": "Switch ▸",
  "account.connectWallet": "Connect wallet",
  "account.walletInstruction": "Choose your browser wallet. {network} will be added automatically if not already configured.",
  "account.waitingForSignature": "Waiting for signature…",
  "account.verifying": "Verifying…",
  "account.signInWithEthereum": "Sign in with Ethereum ▸",
  "account.signIn": "Sign in",
  "account.signatureInstruction": "Sign a message in your wallet to prove ownership. No gas required — this is a signature, not a transaction.",
  "account.switchFirst": "Switch to {network} first",
  "account.useDifferentWallet": "← Use a different wallet",
  "account.authenticated": "Authenticated",
  "account.registrationWalletMismatch": "This registration draft belongs to the wallet that started sign-in. Switch back to that wallet or {restartLink}.",
  "account.startNewDraft": "start a new draft",
  "account.resumeSourceClaim": "Resume source claim",
  "account.resumeSourceRegistration": "Resume source registration",
  "account.issueToll": "Issue a toll ▸",
  "account.askQuestion": "Ask a question ▸",
  "account.signingOut": "Signing out…",
  "account.signOut": "Sign out",
  "accountSessions.title": "Signed-in sessions",
  "accountSessions.introduction": "Review account access across browsers. Each sign-in creates a session; device names and locations are not collected.",
  "accountSessions.signOutBoundary": "Signing out ends account access. It does not cancel accepted research jobs or already signed payment authorizations.",
  "accountSessions.refresh": "Refresh sessions",
  "accountSessions.signOutOthers": "Sign out all other sessions",
  "accountSessions.loading": "Loading sessions…",
  "accountSessions.truncated": "Showing the 100 newest sessions. Sign out all other sessions also includes older sessions.",
  "accountSessions.current": "This browser session",
  "accountSessions.session": "Session {id}",
  "accountSessions.issuedAt": "Signed in {date}",
  "accountSessions.expiresAt": "Expires {date}",
  "accountSessions.signOutLabel": "Sign out session {id}",
  "accountSessions.ended": "Your session has ended. Sign in again to manage sessions.",
  "accountSessions.refreshFailed": "Sessions could not be refreshed. Please retry.",
  "accountSessions.selectedSignedOut": "The selected session has been signed out.",
  "accountSessions.othersSignedOut": "Other sessions have been signed out. This session remains active.",
  "accountSessions.signOutUnconfirmed": "Sign-out could not be confirmed. Refresh the list and retry.",
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
  "jobLedger.title": "Public job transfer ledger",
  "jobLedger.description": "Inspect recorded public research transfers, their settlement evidence and a balanced export.",
  "jobLedger.introduction": "Recorded transfers for completed public web dispatches, with customer and Keryx funding shown separately. Questions and customer identities are omitted.",
  "jobLedger.boundary": "This bounded, partial ledger uses separate read snapshots. It is not complete business books, a cash balance or profit. Private invoices, refunds and full purchase revenue remain unavailable.",
  "jobLedger.network": "Selected network: {network}",
  "jobLedger.window": "Payment observation window",
  "jobLedger.days": "Past {count} days",
  "jobLedger.loading": "Reading public transfer evidence…",
  "jobLedger.unavailable": "Public transfer evidence is unavailable. The sealed read-only store may be unsupported or unavailable.",
  "jobLedger.retry": "Read again",
  "jobLedger.exportJson": "Download JSON ledger",
  "jobLedger.exportCsv": "Download balanced CSV",
  "jobLedger.captured": "Reads from {startedAt} to {completedAt}. Payment window starts {from}.",
  "jobLedger.limits": "Up to {runs} recent public-domain runs and {payments} payment rows were inspected. Historical testnet archives are not combined with this selected store.",
  "jobLedger.limitReached": "A scan limit was reached. Coverage remains partial.",
  "jobLedger.browser": "Customer browser funding",
  "jobLedger.treasury": "Keryx treasury sponsorship",
  "jobLedger.unknown": "Unknown funding",
  "jobLedger.offline": "Offline records",
  "jobLedger.access": "Source access transfers",
  "jobLedger.reward": "Creator reward transfers",
  "jobLedger.sponsoredFee": "Sponsored operating-fee transfers",
  "jobLedger.fundingBoundary": "Browser-funded transfers are not Operator expenses. Sponsored fees are not outside-customer revenue. Outside/team customer attribution is unknown.",
  "jobLedger.position": "Cash position and obligations: unknown. Advisory safe spending: {amount}.",
  "jobLedger.profit": "Purchase price, provider invoices, refunds and margin: unavailable.",
  "jobLedger.balance": "Transfer-control trial balance: debit {debit}, credit {credit}.",
  "jobLedger.accounts": "Debit increases an observed recipient-role transfer account; credit decreases an observed sender-funding-role account. These are transfer control accounts, not revenue or expense accounts.",
  "jobLedger.jobs": "Observed public jobs",
  "jobLedger.noJobs": "No eligible public web dispatches were observed in this bounded slice.",
  "jobLedger.job": "Dispatch {id}",
  "jobLedger.created": "Completed {createdAt}",
  "jobLedger.coverage": "Leg coverage: {coverage}. Finish-time expected recorded legs: {count}.",
  "jobLedger.coverageMatched": "matched finish-time count",
  "jobLedger.coverageIncomplete": "incomplete",
  "jobLedger.coverageUnknown": "unknown",
  "jobLedger.receipt": "Public settlement receipt",
  "jobLedger.decisions": "Recorded public decisions",
  "jobLedger.source": "Source identity",
  "jobLedger.kind": "Transfer kind",
  "jobLedger.amount": "Exact amount",
  "jobLedger.state": "State",
  "jobLedger.reference": "Settlement reference",
  "jobLedger.settled": "Settled record with retained evidence",
  "jobLedger.pending": "Pending — excluded",
  "jobLedger.failed": "Failed — excluded",
  "jobLedger.simulated": "Simulated — excluded",
  "jobLedger.uncertain": "Uncertain — excluded",
  "jobLedger.refusal": "Evidence gate: {reason}",
  "jobLedger.unknownValue": "Unknown",
  "jobLedger.referenceBoundary": "Transfer references are not automatically Arc transaction hashes. The export checksum detects changes; it is not an authenticity signature or independent settlement confirmation.",
  "jobLedger.back": "Operator overview",
} as const);
export type MessageKey = keyof typeof englishMessages;
type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Tail}` ? Name | Placeholders<Tail> : never;
export type MessageParameters<K extends MessageKey, Value = string | number> = Record<Placeholders<typeof englishMessages[K]>, Value>;
export type MessageArguments<K extends MessageKey, Value = string | number> = [Placeholders<typeof englishMessages[K]>] extends [never] ? [] : [MessageParameters<K, Value>];
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
