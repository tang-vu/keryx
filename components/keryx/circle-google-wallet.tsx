"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CIRCLE_GOOGLE_CONNECTOR_ID } from "@/lib/circle-wallet-config";
import { circleWalletIdentity, circleWalletCanSign, startGoogleWalletLogin, resumeGoogleWalletLogin } from "@/lib/circle-wallet-browser";
import { circleWalletPublicConfigured } from "@/lib/circle-wallet-config";
import { readCircleWalletAvailability } from "@/lib/circle-wallet-availability";

import { useUiMessages } from "@/lib/i18n/ui-copy";






/** Absent configuration is an honest unavailable option, never a simulated wallet. */
type GoogleWalletButtonProps = {
  disabled?: boolean; onSelect?: (attempt: symbol) => void; onConnected?: () => void;
  onConnectionFailed?: (attempt: symbol) => void; reconnectOnly?: boolean;
};
export function CircleGoogleWalletButton(props: GoogleWalletButtonProps) {
  return circleWalletPublicConfigured() ? <ConfiguredGoogleWalletButton {...props}/> : null;
}
function ConfiguredGoogleWalletButton({ disabled = false, onSelect, onConnected, onConnectionFailed, reconnectOnly = false }: GoogleWalletButtonProps) {
  const copy = useUiMessages();
  const { connectors, connectAsync, isPending } = useConnect();
  const { connector: currentConnector } = useAccount();
  const [availability, setAvailability] = useState<"loading" | "ready" | "error" | "disabled">("loading");
  const [check, setCheck] = useState(0);
  const [starting, setStarting] = useState(false);
  const startPending = useRef(false);
  const [, renderExpiry] = useState(0);
  useEffect(() => {
    if (!reconnectOnly) return;
    const timer = setInterval(() => renderExpiry(value => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [reconnectOnly]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void readCircleWalletAvailability(controller.signal)
      .then(value => { if (active) setAvailability(value ? "ready" : "disabled"); })
      .catch(() => { if (active) setAvailability("error"); });
    return () => { active = false; controller.abort(); };
  }, [check]);
  const connector = connectors.find(value => value.id === CIRCLE_GOOGLE_CONNECTOR_ID);
  if (availability === "disabled" || !connector) return null;
  if (reconnectOnly && (currentConnector?.id !== CIRCLE_GOOGLE_CONNECTOR_ID || circleWalletCanSign())) return null;
  return <div>
    {(availability === "loading" || availability === "error") && <p role="status" className="mb-2 font-mono text-xs leading-relaxed text-ink-2">
      {availability === "loading" ? copy("walletPicker.loading") : copy("googleWallet.startFailed")}
    </p>}
    <button type="button" disabled={disabled || isPending || starting || availability === "loading"} aria-busy={availability === "loading" || starting || isPending} onClick={() => {
    if (availability === "error") {
      setAvailability("loading"); setCheck(value => value + 1);
      return;
    }
    if (availability !== "ready" || startPending.current) return;
    startPending.current = true; setStarting(true);
    const attempt = Symbol();
    onSelect?.(attempt);
    const failed = () => {
      onConnectionFailed?.(attempt);
      toast.error(copy("googleWallet.startFailed"));
    };
    const operation = circleWalletIdentity() && !circleWalletCanSign()
      ? startGoogleWalletLogin()
      : connectAsync({ connector }).then(() => onConnected?.());
    void operation.catch(failed).finally(() => { startPending.current = false; setStarting(false); });
  }} className="flex w-full items-center gap-3 border border-ink bg-paper px-4 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:bg-seal hover:text-cream disabled:cursor-not-allowed disabled:opacity-60">
    {isPending || starting || availability === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <span aria-hidden="true" className="w-4 text-center font-sans text-base font-semibold">G</span>}
    <span>{availability === "error" ? copy("routeError.retry") : reconnectOnly ? copy("googleWallet.reconnect") : copy("googleWallet.continue")}</span>
  </button></div>;
}

/** OAuth callback handler. Place on /connect; it emits no wallet authority until Circle and Keryx verify it. */
export function CircleGoogleCallback(props: { onConnected?: () => void }) {
  return circleWalletPublicConfigured() ? <ConfiguredGoogleCallback {...props}/> : null;
}
function ConfiguredGoogleCallback({ onConnected }: { onConnected?: () => void }) {
  const copy = useUiMessages();
  const { connectors, connectAsync } = useConnect();
  const [status, setStatus] = useState<string | null>(null);
  const completed = useRef(false);
  const connectedCallback = useRef(onConnected);
  useEffect(() => { connectedCallback.current = onConnected; }, [onConnected]);
  useEffect(() => {
    if (!circleWalletPublicConfigured()) return;
    const connector = connectors.find(value => value.id === CIRCLE_GOOGLE_CONNECTOR_ID); if (!connector) return;
    let active = true;
    void resumeGoogleWalletLogin().then(async identity => {
      if (!identity || !active || completed.current) return;
      completed.current = true;
      setStatus(copy("googleWallet.connecting"));
      await connectAsync({ connector });
      if (active) { setStatus(copy("googleWallet.connected")); connectedCallback.current?.(); }
    }).catch(error => { if (active) setStatus(error instanceof Error ? error.message : copy("googleWallet.completeFailed")); });
    return () => { active = false; };
  }, [connectors, connectAsync]);
  return status ? <p role="status" className="font-mono text-xs leading-relaxed text-ink-2">{status}</p> : null;
}
