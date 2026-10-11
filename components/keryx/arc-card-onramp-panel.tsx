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

import { createMessages } from "@/lib/i18n/messages";
import { useEffect, useRef, useState } from "react";
import type { OnrampKit, OnrampSession, OnrampWidget } from "@circle-fin/onramp-kit";

const copy = createMessages("en");

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
const ENDPOINT = "/api/onramp/session";
const UNAVAILABLE = copy("cardFunding.unavailable");

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
        setMessage(response.status === 401 ? copy("cardFunding.signIn")
          : response.status === 429 ? copy("cardFunding.rateLimited")
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
        onDepositSubmitted: () => say(copy("cardFunding.providerReceived")),
        onDepositSettled: () => say(copy("cardFunding.providerSettled")),
        onDepositNotCompleted: ({ code }) => say(code === "CANCELED_BY_CUSTOMER"
          ? copy("cardFunding.windowClosed")
          : copy("cardFunding.providerIncomplete")),
        // Also fires when the window simply never reports back, so it must not claim a failure.
        onInitializationError: () => say(copy("cardFunding.windowUnknown")),
        onSessionExpired: () => { if (live.current) { setPrepared(null); setMessage(copy("cardFunding.expired")); } },
      });
      if (result.status === "blocked") {
        setMessage(result.reason === "popup_blocked"
          ? copy("cardFunding.popupBlocked")
          : copy("cardFunding.browserUnsupported"));
        return;
      }
      widget.current = result.widget;
      setMessage(copy("cardFunding.opened"));
    } catch {
      setPrepared(null);
      setMessage(copy("cardFunding.invalidSession"));
    }
  }

  return <section className="space-y-2 border border-line bg-paper-2 px-4 py-3 text-sm" aria-label={copy("cardFunding.label")}>
    <h2 className="font-mono text-xs">{copy("cardFunding.title")}</h2>
    <p className="font-serif text-sm">{copy("cardFunding.providerNotice")}</p>
    <p className="font-serif text-sm">{copy("cardFunding.deliveryNotice")}</p>
    {prepared && <p className="break-all font-mono text-xs">{copy("cardFunding.session", { wallet: String(prepared.session.destinationWallet ?? ""), expiresAt: new Date(prepared.session.expiresAt).toLocaleTimeString() })}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={control} disabled={busy} onClick={() => void prepare()}>{busy ? copy("cardFunding.preparing") : prepared ? copy("cardFunding.prepareNew") : copy("cardFunding.prepare")}</button>
      {prepared && <button type="button" className={control} disabled={busy} onClick={open}>{copy("cardFunding.open")}</button>}
    </div>
    <p role="status" className="font-serif text-sm">{message}</p>
  </section>;
}
