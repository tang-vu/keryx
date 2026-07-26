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
 *     held(Circle) >= paid(ledger) - withdrawn(ledger) - tolerance
 *
 * A wallet holding MORE than Keryx accounts for is not an error and never alerts. Gateway balances
 * are the creator's own: they may deposit into them, or be paid by some other x402 service entirely.
 * Only a SHORTFALL is a finding, because that is the one direction that means Keryx overstated what
 * a creator has — the failure a skeptic actually cares about.
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
 * - `short`     — Circle holds less than Keryx claims. The only alarm.
 * - `unknown`   — the API did not answer for this address. Absence of an answer is not a zero.
 */
export type AccountVerdict = "confirmed" | "surplus" | "short" | "unknown";

export interface AccountParity extends LedgerAccount {
  /** What Keryx's books say is still sitting in the Gateway: paid − withdrawn. */
  owedUsdc: number;
  /** What Circle says it holds (available + in-flight batch). Null when unreachable. */
  heldUsdc: number | null;
  /** held − owed. Positive is the creator's surplus; negative is our shortfall. */
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
  counts: Record<AccountVerdict, number>;
  /** Shortfalls only, worst first — what the watchdog alerts on. */
  issues: AccountParity[];
}

/** Held balances keyed by lowercased address. A missing key means "not answered". */
export type HeldBalances = Map<string, number | null>;

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Reconcile one wallet. Pure — the caller does the I/O and hands both numbers in. */
export function reconcileAccount(account: LedgerAccount, held: number | null): AccountParity {
  const owedUsdc = round6(account.paidUsdc - account.withdrawnUsdc);
  const toleranceUsdc = round6(account.withdrawCount * WITHDRAW_FEE_USDC + DUST_USDC);

  if (held === null) {
    return { ...account, owedUsdc, heldUsdc: null, deltaUsdc: null, toleranceUsdc, verdict: "unknown" };
  }

  const deltaUsdc = round6(held - owedUsdc);
  const verdict: AccountVerdict =
    deltaUsdc < -toleranceUsdc ? "short" : deltaUsdc > toleranceUsdc ? "surplus" : "confirmed";

  return { ...account, owedUsdc, heldUsdc: round6(held), deltaUsdc, toleranceUsdc, verdict };
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
): SettlementParityReport {
  const accounts = ledger
    .filter((a) => a.paidUsdc - a.withdrawnUsdc > DUST_USDC)
    .map((a) => reconcileAccount(a, held.get(a.address.toLowerCase()) ?? null))
    .sort((a, b) => b.owedUsdc - a.owedUsdc);

  const counts: Record<AccountVerdict, number> = { confirmed: 0, surplus: 0, short: 0, unknown: 0 };
  let owedUsdc = 0;
  let confirmedUsdc = 0;
  for (const a of accounts) {
    counts[a.verdict] += 1;
    owedUsdc += a.owedUsdc;
    // Only balances Circle actually answered for count as confirmed, and a wallet is credited
    // with what it is owed, not its surplus — this figure means "independently backed", so it
    // must never exceed the claim it is backing.
    if (a.heldUsdc !== null && a.verdict !== "short") confirmedUsdc += a.owedUsdc;
  }

  return {
    checkedAt,
    accounts,
    owedUsdc: round6(owedUsdc),
    confirmedUsdc: round6(confirmedUsdc),
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
  counts: Record<AccountVerdict, number>;
  /** Per wallet, so a creator page can show Circle's own figure for its address. */
  accounts: { address: string; label?: string; owedUsdc: number; heldUsdc: number | null; verdict: AccountVerdict }[];
}

export function summarizeSettlement(report: SettlementParityReport): SettlementParitySummary {
  return {
    checkedAt: report.checkedAt,
    owedUsdc: report.owedUsdc,
    confirmedUsdc: report.confirmedUsdc,
    counts: report.counts,
    accounts: report.accounts.map((a) => ({
      address: a.address,
      ...(a.label ? { label: a.label } : {}),
      owedUsdc: a.owedUsdc,
      heldUsdc: a.heldUsdc,
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
