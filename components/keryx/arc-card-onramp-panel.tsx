"use client";

/**
 * ArcCardOnrampPanel — optional "buy USDC with a card" step for a signed-in mainnet wallet.
 *
 * Two deliberate clicks: "Prepare" mints a session for the signed-in wallet and loads Circle's
 * kit; "Open" must then run synchronously inside the click so the browser allows the purchase
 * window. The purchase happens entirely on Circle's origin in that window. Widget events are
 * best-effort hints only; the wallet's on-chain balance is the evidence that USDC arrived.
 *
 * Renders nothing unless the server reports the feature as configured.
 */

import { useEffect, useRef, useState } from "react";
import type { OnrampKit, OnrampSession, OnrampWidget } from "@circle-fin/onramp-kit";

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
const ENDPOINT = "/api/onramp/session";
const UNAVAILABLE = "Card funding is unavailable right now. No purchase was started.";

export function ArcCardOnrampPanel() {
  const [available, setAvailable] = useState(false);
  const [prepared, setPrepared] = useState<{ kit: OnrampKit; session: OnrampSession } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const widget = useRef<OnrampWidget | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    fetch(ENDPOINT, { cache: "no-store" })
      .then(response => (response.ok ? response.json() : null))
      .then(value => { if (live.current) setAvailable(value?.available === true); })
      .catch(() => { /* Unknown availability keeps the option hidden. */ });
    // Releases the kit's window message listener; this also closes an open purchase window.
    return () => { live.current = false; widget.current?.close(); };
  }, []);

  if (!available) return null;

  const say = (text: string) => { if (live.current) setMessage(text); };

  async function prepare() {
    setBusy(true); setMessage(""); setPrepared(null);
    try {
      const [{ createOnrampKit }, response] = await Promise.all([
        import("@circle-fin/onramp-kit"),
        fetch(ENDPOINT, { method: "POST", cache: "no-store" }),
      ]);
      const value = await response.json().catch(() => null);
      if (!live.current) return;
      if (!response.ok || !value?.session) {
        setMessage(response.status === 401 ? "Sign in with your wallet before buying USDC."
          : response.status === 429 ? "Too many purchase sessions were prepared. Wait a minute, then try again."
          : UNAVAILABLE);
        return;
      }
      setPrepared({ kit: createOnrampKit(), session: value.session as OnrampSession });
    } catch { say(UNAVAILABLE); }
    finally { if (live.current) setBusy(false); }
  }

  /** Synchronous on purpose: any await before openWindow makes the browser block the window. */
  function open() {
    if (!prepared) return;
    try {
      widget.current?.close();
      const result = prepared.kit.openWindow({
        session: prepared.session,
        onDepositSubmitted: () => say("The provider received your purchase. USDC reaches your wallet after the provider settles it; refresh your wallet balance to confirm."),
        onDepositSettled: () => say("The provider reports this purchase as settled. Confirm the USDC in your wallet balance before depositing to Gateway."),
        onDepositNotCompleted: ({ code }) => say(code === "CANCELED_BY_CUSTOMER"
          ? "The purchase window was closed before a purchase was submitted."
          : "The provider did not complete this purchase. Check the provider's own messages before trying again."),
        // Also fires when the window simply never reports back, so it must not claim a failure.
        onInitializationError: () => say("Keryx received no confirmation that the purchase window loaded. If it shows Circle's purchase page, continue there; otherwise prepare a new purchase."),
        onSessionExpired: () => { if (live.current) { setPrepared(null); setMessage("This purchase session expired. Prepare a new one to continue."); } },
      });
      if (result.status === "blocked") {
        setMessage(result.reason === "popup_blocked"
          ? "Your browser blocked the purchase window. Allow pop-ups for this site, then select Open again."
          : "This browser cannot open the purchase window. Open Keryx in your device's regular browser.");
        return;
      }
      widget.current = result.widget;
      setMessage("Purchase window opened. Keep this page open until you finish there.");
    } catch {
      setPrepared(null);
      setMessage("This purchase session is no longer valid. Prepare a new one to continue.");
    }
  }

  return <section className="space-y-2 border border-line bg-paper-2 px-4 py-3 text-sm" aria-label="Buy USDC with a card">
    <h2 className="font-mono text-xs">Buy USDC on Arc with a card</h2>
    <p className="font-serif text-sm">Pay with a debit card, Apple Pay or Google Pay through Circle&apos;s Arc Onramp. Circle&apos;s payment providers verify your identity and take the payment in a separate window. Availability depends on your country, credit cards are not supported, and the providers show their own fees before you pay.</p>
    <p className="font-serif text-sm">USDC is delivered to your signed-in wallet on Arc. Keryx never receives the funds or your card details. This does not buy research or fund a budget: deposit to Gateway as a separate step afterwards.</p>
    {prepared && <p className="break-all font-mono text-xs">Delivery wallet: {String(prepared.session.destinationWallet ?? "")} · session valid until {new Date(prepared.session.expiresAt).toLocaleTimeString()}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={control} disabled={busy} onClick={() => void prepare()}>{busy ? "Preparing…" : prepared ? "Prepare a new purchase" : "Prepare card purchase"}</button>
      {prepared && <button type="button" className={control} disabled={busy} onClick={open}>Open Arc Onramp</button>}
    </div>
    <p role="status" className="font-serif text-sm">{message}</p>
  </section>;
}
