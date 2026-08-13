/**
 * settlement-parity.ts — checks Keryx's payout ledger against Circle's own books.
 *
 * Keryx tells creators what it paid them. Until now nobody could check that claim: a citation
 * settles inside Circle's Gateway, so the receipt on file is a Circle transfer id, not an EVM
 * hash — there is no arcscan page to open, and 7,893 payment rows carry exactly zero on-chain
 * hashes. The money is real (a cash-out mints it on Arc, and *those* rows do carry hashes), but
 * "trust our own database" is a weak answer for a product whose whole premise is that creators
 * really get paid.
 *
 * Circle answers it for us. The Gateway balance API is public and unauthenticated: anyone can ask
 * it what it holds for any address. So for every wallet Keryx has ever paid we can state a figure
 * and have a third party confirm it — and publish both, side by side.
 *
 * The invariant, stated so it can only catch us flattering ourselves:
 *
 *     held(Circle) + onchain(wallet) >= paid(ledger) - withdrawn(ledger) - tolerance
 *
 * A wallet holding MORE than Keryx accounts for is not an error and never alerts. Gateway balances
 * are the creator's own: they may deposit into them, or be paid by some other x402 service entirely.
 * Only a SHORTFALL is a finding, because that is the one direction that means Keryx overstated what
 * a creator has — the failure a skeptic actually cares about.
 *
 * The wallet term is not slack either, and the first production run is why it exists: two creators
 * came up short by $0.046 and $0.061, and both were holding exactly that money in their own wallets
 * on-chain. A Gateway balance belongs to its owner, who may move it through this app, Circle's CLI,
 * or anything else that signs for them — and only the first of those leaves a row in Keryx's books.
 * Reading the Gateway alone, every self-service cash-out would be reported as missing money.
 *
 * Tolerance is not fudge. Circle charges a fee to withdraw, and the ledger records what the creator
 * asked to move, not the fee burned alongside it, so each recorded cash-out legitimately leaves the
 * Gateway a little lighter than the ledger implies. The allowance is that fee times the number of
 * cash-outs, plus a dust term for 6-decimal rounding.
 *
 * Read the ledger BEFORE the balances (scripts/check-settlement.mts does). Settlement runs
 * continuously, so whichever is read second is the newer number; taking the ledger first means an
 * in-flight payment can only make Circle look richer than our claim, which is the harmless
 * direction. Read the other way round, every busy minute would invent a shortfall.
 */

/** sync_state key the watchdog writes its summary under; /api/health serves it to /status. */
export const SETTLEMENT_PARITY_STATE_KEY = "settlementParity";

/** Circle's withdraw fee, reserved out of the balance on every cash-out (USDC). */
const WITHDRAW_FEE_USDC = 0.005;

/** Rounding slack for 6-decimal money crossing two systems (USDC). */
const DUST_USDC = 0.000_01;

/** One wallet as Keryx's ledger sees it. */
export interface LedgerAccount {
  /** Payee address exactly as the ledger recorded it (checksummed for display). */
  address: string;
  /** Human label for the payee — source name, or author name where the split names one. */
  label?: string;
  /** Sum of settled payments to this address. */
  paidUsdc: number;
  paymentCount: number;
  /** Sum of recorded cash-outs drawn from this address. */
  withdrawnUsdc: number;
  withdrawCount: number;
}

/**
 * - `confirmed` — Circle holds what Keryx says it does, inside tolerance.
 * - `surplus`   — Circle holds more. The creator's own money; noted, never an issue.
 * - `cashedOut` — Circle holds less, but the creator's own wallet holds the difference on-chain.
 *                 They moved their money themselves, which they may do at any time and by any
 *                 route; the payouts are still fully accounted for, so this never alarms.
 * - `short`     — neither the Gateway nor the wallet accounts for what Keryx claims. The alarm.
 * - `unknown`   — Circle did not answer, or a Gateway shortfall could not be checked on Arc.
 *                 Absence of an answer is not a zero and cannot prove a settlement failure.
 */
export type AccountVerdict = "confirmed" | "surplus" | "cashedOut" | "short" | "unknown";

export interface AccountParity extends LedgerAccount {
  /** What Keryx's books say should still be in the Gateway: paid − withdrawn. */
  owedUsdc: number;
  /** What Circle says it holds (available + in-flight batch). Null when unreachable. */
  heldUsdc: number | null;
  /** Plain USDC in the wallet itself. Only read for accounts the Gateway came up short on. */
  onchainUsdc?: number | null;
  /** held − owed. Positive is the creator's surplus; negative is a Gateway shortfall. */
  deltaUsdc: number | null;
  /** How far held may sit below owed before it counts: withdraw fees + dust. */
  toleranceUsdc: number;
  verdict: AccountVerdict;
}

export interface SettlementParityReport {
  checkedAt: string;
  accounts: AccountParity[];
  /** Ledger total still owed across every wallet checked. */
  owedUsdc: number;
  /** Circle-confirmed total across the wallets that answered. */
  confirmedUsdc: number;
  /** Claims the Gateway no longer holds because the creator moved the money to their own wallet. */
  cashedOutUsdc: number;
  counts: Record<AccountVerdict, number>;
  /** Shortfalls only, worst first — what the watchdog alerts on. */
  issues: AccountParity[];
}

/** Held balances keyed by lowercased address. A missing key means "not answered". */
export type HeldBalances = Map<string, number | null>;

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Reconcile one wallet. Pure — the caller does the I/O and hands the numbers in.
 *
 * `onchain` is optional and only worth reading for a wallet the Gateway came up short on: it
 * answers "did this money leave the Gateway *to its owner*?", which in a non-custodial product is
 * the ordinary explanation. A creator can cash out through this app, Circle's CLI, or anything
 * else that signs for their wallet, and only the first of those leaves a row in Keryx's books.
 */
export function reconcileAccount(
  account: LedgerAccount,
  held: number | null,
  onchain?: number | null,
): AccountParity {
  const owedUsdc = round6(account.paidUsdc - account.withdrawnUsdc);
  const toleranceUsdc = round6(account.withdrawCount * WITHDRAW_FEE_USDC + DUST_USDC);
  const base = { ...account, owedUsdc, toleranceUsdc, ...(onchain === undefined ? {} : { onchainUsdc: onchain }) };

  if (held === null) {
    return { ...base, heldUsdc: null, deltaUsdc: null, verdict: "unknown" };
  }

  const deltaUsdc = round6(held - owedUsdc);
  let verdict: AccountVerdict =
    deltaUsdc < -toleranceUsdc ? "short" : deltaUsdc > toleranceUsdc ? "surplus" : "confirmed";

  // Gateway plus wallet is the whole of what a payout could have become. If together they cover
  // the claim, nothing is missing — the creator simply moved their own money somewhere Keryx
  // does not book. Only a gap that survives both readings is a finding.
  if (verdict === "short") {
    if (onchain === null) {
      // The caller attempted the second evidence leg and Arc did not answer. Keep `undefined`
      // distinct: the first pass intentionally omits the chain read so it can identify which
      // wallets need one. Once attempted, an unavailable RPC is uncertainty, not proof of zero.
      verdict = "unknown";
    } else if (typeof onchain === "number" && held + onchain >= owedUsdc - toleranceUsdc) {
      verdict = "cashedOut";
    }
  }

  return { ...base, heldUsdc: round6(held), deltaUsdc, verdict };
}

/**
 * Reconcile the whole ledger against Circle.
 *
 * Wallets Keryx owes nothing to (paid out in full, or never paid) are dropped: an empty balance
 * confirming an empty claim proves nothing and would bury the rows that do carry weight.
 */
export function reconcileSettlement(
  ledger: LedgerAccount[],
  held: HeldBalances,
  checkedAt: string,
  onchain: HeldBalances = new Map(),
): SettlementParityReport {
  const accounts = ledger
    .filter((a) => a.paidUsdc - a.withdrawnUsdc > DUST_USDC)
    .map((a) => {
      const key = a.address.toLowerCase();
      // `has` rather than `??`: an address the caller looked up and got no answer for is a known
      // unknown, and must not be confused with one that was never worth looking up.
      return reconcileAccount(
        a,
        held.get(key) ?? null,
        onchain.has(key) ? onchain.get(key) : undefined,
      );
    })
    .sort((a, b) => b.owedUsdc - a.owedUsdc);

  const counts: Record<AccountVerdict, number> = {
    confirmed: 0,
    surplus: 0,
    cashedOut: 0,
    short: 0,
    unknown: 0,
  };
  let owedUsdc = 0;
  let confirmedUsdc = 0;
  let cashedOutUsdc = 0;
  for (const a of accounts) {
    counts[a.verdict] += 1;
    owedUsdc += a.owedUsdc;
    // A wallet is credited with what it is owed, never its surplus — this figure means
    // "independently backed", so it must not exceed the claim it backs. Cash-outs are counted
    // apart: that money is accounted for, but it is the wallet holding it now, not the Gateway,
    // and folding the two would overstate what Circle actually confirmed.
    if (a.verdict === "confirmed" || a.verdict === "surplus") confirmedUsdc += a.owedUsdc;
    if (a.verdict === "cashedOut") cashedOutUsdc += a.owedUsdc;
  }

  return {
    checkedAt,
    accounts,
    owedUsdc: round6(owedUsdc),
    confirmedUsdc: round6(confirmedUsdc),
    cashedOutUsdc: round6(cashedOutUsdc),
    counts,
    issues: accounts
      .filter((a) => a.verdict === "short")
      .sort((a, b) => (a.deltaUsdc ?? 0) - (b.deltaUsdc ?? 0)),
  };
}

/** What /status needs: the verdict and the per-wallet rows, without the tolerance arithmetic. */
export interface SettlementParitySummary {
  checkedAt: string;
  owedUsdc: number;
  confirmedUsdc: number;
  cashedOutUsdc: number;
  counts: Record<AccountVerdict, number>;
  /** Per wallet, so a creator page can show Circle's own figure for its address. */
  accounts: {
    address: string;
    label?: string;
    owedUsdc: number;
    heldUsdc: number | null;
    onchainUsdc?: number | null;
    verdict: AccountVerdict;
  }[];
}

export function summarizeSettlement(report: SettlementParityReport): SettlementParitySummary {
  return {
    checkedAt: report.checkedAt,
    owedUsdc: report.owedUsdc,
    confirmedUsdc: report.confirmedUsdc,
    cashedOutUsdc: report.cashedOutUsdc,
    counts: report.counts,
    accounts: report.accounts.map((a) => ({
      address: a.address,
      ...(a.label ? { label: a.label } : {}),
      owedUsdc: a.owedUsdc,
      heldUsdc: a.heldUsdc,
      ...(a.onchainUsdc === undefined ? {} : { onchainUsdc: a.onchainUsdc }),
      verdict: a.verdict,
    })),
  };
}

/**
 * Name each wallet the way a reader would recognise it.
 *
 * The ledger can only offer the source a payment came through, which is wrong for the majority of
 * rows: fetch tolls pay the source's own wallet, but citation rewards are split to the *authors'*
 * wallets, so most addresses on this list belong to a person, not a publication. Left unlabelled,
 * the biggest balances on the page read as anonymous hex.
 */
export function labelAccounts<T extends LedgerAccount>(
  accounts: T[],
  sources: { name: string; walletAddress: string; authors?: { name: string; walletAddress: string }[] }[],
): T[] {
  const names = new Map<string, string>();
  for (const s of sources) {
    if (s.walletAddress) names.set(s.walletAddress.toLowerCase(), s.name);
    for (const a of s.authors ?? []) {
      // Author first: their wallet is the one citation money lands in. Where an author shares the
      // source's wallet the source name already sits there and is the more useful of the two.
      const key = a.walletAddress?.toLowerCase();
      if (key && !names.has(key)) names.set(key, `${a.name} · ${s.name}`);
    }
  }
  return accounts.map((a) => {
    const name = names.get(a.address.toLowerCase());
    return name ? { ...a, label: name } : a;
  });
}

/** Circle's figure for one wallet out of a persisted summary, for a creator-facing page. */
export function findAccount(
  summary: SettlementParitySummary | null,
  address: string | null | undefined,
): SettlementParitySummary["accounts"][number] | null {
  if (!summary || !address) return null;
  const want = address.toLowerCase();
  return summary.accounts.find((a) => a.address.toLowerCase() === want) ?? null;
}
