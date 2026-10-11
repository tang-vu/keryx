"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CIRCLE_GOOGLE_CONNECTOR_ID } from "@/lib/circle-wallet-config";
import { circleWalletIdentity, circleWalletCanSign, startGoogleWalletLogin, resumeGoogleWalletLogin } from "@/lib/circle-wallet-browser";
import { circleWalletPublicConfigured } from "@/lib/circle-wallet-config";
import { createMessages } from "@/lib/i18n/messages";

const copy = createMessages("en");


/** Absent configuration is an honest unavailable option, never a simulated wallet. */
type GoogleWalletButtonProps = {
  disabled?: boolean; onSelect?: (attempt: symbol) => void; onConnected?: () => void;
  onConnectionFailed?: (attempt: symbol) => void; reconnectOnly?: boolean;
};
export function CircleGoogleWalletButton(props: GoogleWalletButtonProps) {
  return circleWalletPublicConfigured() ? <ConfiguredGoogleWalletButton {...props}/> : null;
}
function ConfiguredGoogleWalletButton({ disabled = false, onSelect, onConnected, onConnectionFailed, reconnectOnly = false }: GoogleWalletButtonProps) {
  const { connectors, connectAsync, isPending } = useConnect();
  const { connector: currentConnector } = useAccount();
  const [available, setAvailable] = useState(false);
  const [, renderExpiry] = useState(0);
  useEffect(() => {
    if (!reconnectOnly) return;
    const timer = setInterval(() => renderExpiry(value => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [reconnectOnly]);
  useEffect(() => {
    if (!circleWalletPublicConfigured()) return;
    let active = true;
    void fetch("/api/auth/circle/config", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then(async response => response.ok && (await response.json()).available === true)
      .then(value => { if (active) setAvailable(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const connector = connectors.find(value => value.id === CIRCLE_GOOGLE_CONNECTOR_ID);
  if (!available || !connector) return null;
  if (reconnectOnly && (currentConnector?.id !== CIRCLE_GOOGLE_CONNECTOR_ID || circleWalletCanSign())) return null;
  return <button type="button" disabled={disabled || isPending} onClick={() => {
    const attempt = Symbol();
    onSelect?.(attempt);
    const failed = () => {
      onConnectionFailed?.(attempt);
      toast.error(copy("googleWallet.startFailed"));
    };
    if (circleWalletIdentity() && !circleWalletCanSign()) {
      void startGoogleWalletLogin().catch(failed);
      return;
    }
    void connectAsync({ connector }).then(() => onConnected?.()).catch(failed);
  }} className="flex w-full items-center gap-3 border border-ink bg-paper px-4 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:bg-seal hover:text-cream disabled:cursor-not-allowed disabled:opacity-60">
    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <span aria-hidden="true" className="w-4 text-center font-sans text-base font-semibold">G</span>}
    <span>{reconnectOnly ? copy("googleWallet.reconnect") : copy("googleWallet.continue")}</span>
  </button>;
}

/** OAuth callback handler. Place on /connect; it emits no wallet authority until Circle and Keryx verify it. */
export function CircleGoogleCallback(props: { onConnected?: () => void }) {
  return circleWalletPublicConfigured() ? <ConfiguredGoogleCallback {...props}/> : null;
}
function ConfiguredGoogleCallback({ onConnected }: { onConnected?: () => void }) {
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
