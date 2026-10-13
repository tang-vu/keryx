"use client";
import { DisplayTime } from "@/components/keryx/display-time";
import { createRichMessages as createDateMessages } from "@/lib/i18n/rich-messages";

/**
 * ArcCardOnrampPanel — bank-first funding for a signed-in wallet; legacy export retained.
 *
 * Two deliberate clicks: "Prepare" mints a session for the signed-in wallet and loads Circle's
 * kit; "Open" must then run synchronously inside the click so the browser allows the purchase
 * window. The purchase happens entirely on Circle's origin in that window. Widget events are
 * best-effort hints only; the wallet's on-chain balance is the evidence that USDC arrived.
 *
 * A sandbox capability response shows why Arc bank funding is unavailable, without a launch.
 */

import { createMessages } from "@/lib/i18n/messages";
import { useEffect, useRef, useState } from "react";
import type { OnrampKit, OnrampSession, OnrampWidget } from "@circle-fin/onramp-kit";

const copy = createMessages("en");

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
const ENDPOINT = "/api/onramp/session";
const UNAVAILABLE = copy("cardFunding.unavailable");
const PRODUCTION_ORIGIN = "https://onramp.arc.io";

export function ArcCardOnrampPanel() {
  const [available, setAvailable] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [prepared, setPrepared] = useState<{ kit: OnrampKit; session: OnrampSession } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const widget = useRef<OnrampWidget | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    fetch(ENDPOINT, { cache: "no-store" })
      .then(response => (response.ok ? response.json() : null))
      .then(value => {
        if (!live.current) return;
        setSandbox(value?.environment === "sandbox");
        // Accept the old boolean-only production response, but never unknown environments/origins.
        setAvailable(value?.available === true && (value.environment === undefined || value.environment === "production")
          && (value.widgetOrigin === undefined || value.widgetOrigin === PRODUCTION_ORIGIN)
          && (value.bankTransfer === undefined || value.bankTransfer === "provider-dependent"));
      })
      .catch(() => { /* Unknown availability keeps the option hidden. */ });
    // Releases the kit's window message listener; this also closes an open purchase window.
    return () => { live.current = false; widget.current?.close(); };
  }, []);

  if (!available && !sandbox) return null;

  const say = (text: string) => { if (live.current) setMessage(text); };

  async function prepare() {
    if (!available) return;
    widget.current?.close(); widget.current = null;
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
      const session = value.session as OnrampSession & { environment?: unknown };
      const url = new URL(session.widgetUrl ?? "");
      const expiry = Date.parse(session.expiresAt);
      if ((session.environment !== undefined && session.environment !== "production")
        || url.origin !== PRODUCTION_ORIGIN || url.username || url.password
        || typeof session.sessionToken !== "string" || !session.sessionToken
        || !/^0x[0-9a-f]{40}$/i.test(String(session.destinationWallet ?? "")) || /^0x0{40}$/i.test(String(session.destinationWallet))
        || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 30 * 60_000) {
        setMessage(copy("cardFunding.invalidSession")); return;
      }
      setPrepared({ kit: createOnrampKit({ widgetBaseUrl: PRODUCTION_ORIGIN }), session });
    } catch { say(UNAVAILABLE); }
    finally { if (live.current) setBusy(false); }
  }

  /** Synchronous on purpose: any await before openWindow makes the browser block the window. */
  function open() {
    if (!prepared) return;
    if (Date.parse(prepared.session.expiresAt) <= Date.now()) {
      widget.current?.close(); widget.current = null;
      setPrepared(null); setMessage(copy("cardFunding.expired")); return;
    }
    try {
      widget.current?.close();
      const result = prepared.kit.openWindow({
        session: prepared.session,
        onDepositSubmitted: () => say(copy("cardFunding.providerReceived")),
        onDepositSettled: () => say(copy("cardFunding.providerSettled")),
        onDepositNotCompleted: ({ code }) => say(code === "CANCELED_BY_CUSTOMER"
          ? copy("cardFunding.windowClosed")
          : code === "NO_PAYMENT_OPTIONS" ? copy("cardFunding.methodUnavailable")
          : copy("cardFunding.providerIncomplete")),
        // Also fires when the window simply never reports back, so it must not claim a failure.
        onInitializationError: () => say(copy("cardFunding.windowUnknown")),
        onSessionExpired: () => {
          widget.current?.close(); widget.current = null;
          if (live.current) { setPrepared(null); setMessage(copy("cardFunding.expired")); }
        },
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
    {sandbox ? <p role="note" className="font-serif text-sm">{copy("cardFunding.sandboxUnavailable")}</p>
      : <><p className="font-serif text-sm">{copy("cardFunding.providerNotice")}</p>
        <p className="font-serif text-sm">{copy("cardFunding.deliveryNotice")}</p></>}
    {prepared && <p className="break-all font-mono text-xs">{dateCopy("cardFunding.session", { wallet: String(prepared.session.destinationWallet ?? ""), expiresAt: <DisplayTime value={prepared.session.expiresAt} /> })}</p>}
    {available && <div className="flex flex-wrap gap-2">
      <button type="button" className={control} disabled={busy} onClick={() => void prepare()}>{busy ? copy("cardFunding.preparing") : prepared ? copy("cardFunding.prepareNew") : copy("cardFunding.prepare")}</button>
      {prepared && <button type="button" className={control} disabled={busy} onClick={open}>{copy("cardFunding.open")}</button>}
    </div>}
    <p role="status" className="font-serif text-sm">{message}</p>
  </section>;
}

const dateCopy = createDateMessages("en");
