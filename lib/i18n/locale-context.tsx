"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { browserPaymentProfile } from "../browser-payment-profile";
import { localeDirection, preparedLocales, shippedUiLocales, type UiLocale } from "./locales";
import { canonicalLocaleOwner, createLocaleEpoch, localeScopeKey, parseLocaleReply, readBrowserLocale, readLocaleJson,
  selectPreference, writeBrowserLocale, type LocaleScope } from "./locale-preference";
import { createShellMessages, loadUiShellCatalogue } from "./ui-shell-catalogue";
import type { MessageCatalogue } from "./messages";
import type { UiPreferenceKey } from "@/locales/en/ui-preference";

const englishMessage = createShellMessages("en");
type View = { locale: UiLocale; catalogue: MessageCatalogue; status: UiPreferenceKey | null; ready: boolean };
const initialView: View = { locale: "en", catalogue: {}, status: null, ready: false };
type LocaleContextValue = View & { enabledLocales: readonly UiLocale[]; message: typeof englishMessage; selectLocale(locale: UiLocale): void };
const LocaleContext = createContext<LocaleContextValue>({ ...initialView, enabledLocales: shippedUiLocales, message: englishMessage, selectLocale: () => {} });
const browserFetch: typeof fetch = (input, init) => fetch(input, init);

function browserLanguage(): string | null {
  try { return navigator.languages.slice(0, 16).join(",").slice(0, 4096); } catch { return null; }
}
type Preferences = { explicit: UiLocale | null; account: UiLocale | null; browser: UiLocale | null; acceptLanguage: string | null };
const emptyPreferences = (): Preferences => ({ explicit: null, account: null, browser: null, acceptLanguage: null });
// undefined means identity is unknown; null is a confirmed guest only.
type PreferenceBinding = Omit<LocaleScope, "owner"> & { owner: string | null | undefined };
function sameRealm(left: PreferenceBinding, right: PreferenceBinding) {
  return left.origin === right.origin && left.network === right.network;
}
function sameBinding(left: PreferenceBinding, right: PreferenceBinding) {
  return sameRealm(left, right) && left.owner === right.owner;
}

/** English SSR/hydration; preference resolution starts only after mount. ROOT must
 * explicitly admit a preview list at composition time; preparedLocales is never a default. */
export function LocaleProvider({ children, enabledLocales = shippedUiLocales, connectedWallet = null,
  network = browserPaymentProfile().networkId, fetcher = browserFetch, prepareLocale }: {
  children: ReactNode; enabledLocales?: readonly UiLocale[]; connectedWallet?: string | null; network?: string; fetcher?: typeof fetch;
  prepareLocale?: (locale: UiLocale) => Promise<unknown>;
}) {
  if (!enabledLocales.includes("en") || enabledLocales.some(locale => !preparedLocales.includes(locale))) throw new Error("English locale fallback is required");
  const enabledKey = enabledLocales.join(",");
  const enabled = useRef(enabledLocales);
  const activeRealm = useRef({ network, connectedWallet });
  const [view, setView] = useState(initialView);
  const epoch = useRef(createLocaleEpoch());
  const scope = useRef<PreferenceBinding | null>(null);
  const confirmedScope = useRef<LocaleScope | null>(null);
  const explicitChoice = useRef<{ binding: PreferenceBinding; locale: UiLocale } | null>(null);
  const preferences = useRef<Preferences>(emptyPreferences());
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const requests = useRef(new Set<AbortController>());

  useLayoutEffect(() => {
    enabled.current = enabledLocales;
    activeRealm.current = { network, connectedWallet };
  }, [enabledLocales, network, connectedWallet]);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const controller = new AbortController(); requests.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetcher(path, { ...init, credentials: "same-origin", cache: "no-store", redirect: "error",
        referrerPolicy: "no-referrer", signal: controller.signal });
      // Keep the deadline alive while reading the body too.
      return { response, value: response.ok ? await readLocaleJson(response) : null };
    } finally { clearTimeout(timer); requests.current.delete(controller); }
  }, [fetcher]);

  const renderPreference = useCallback(async (ticket: number, status: UiPreferenceKey | null) => {
    if (!epoch.current.current(ticket)) return;
    const selected = selectPreference(preferences.current, enabled.current).locale;
    try {
      const [catalogue] = await Promise.all([loadUiShellCatalogue(selected, enabled.current), prepareLocale?.(selected)]);
      if (epoch.current.current(ticket)) setView({ locale: selected, catalogue, status, ready: true });
    } catch {
      if (epoch.current.current(ticket)) setView({ locale: "en", catalogue: {}, status: "loadFailed", ready: true });
    }
  }, [prepareLocale]);

  useEffect(() => {
    let live = true;
    const lifecycleEpoch = epoch.current, pendingRequests = requests.current;
    const refresh = async (signedOut = false) => {
      const ticket = epoch.current.invalidate();
      for (const controller of requests.current) controller.abort();
      scope.current = null;
      let origin: string;
      try { origin = window.location.origin; localeScopeKey({ origin, network, owner: null }); } catch {
        confirmedScope.current = null; explicitChoice.current = null; preferences.current = emptyPreferences();
        setView({ ...initialView, status: "unavailable" });
        return;
      }
      const unknown: PreferenceBinding = { origin, network, owner: undefined };
      const compatible = (binding: PreferenceBinding) => sameRealm(binding, unknown) &&
        !(binding.owner && connectedWallet && binding.owner !== canonicalLocaleOwner(connectedWallet));
      if (signedOut || explicitChoice.current && !compatible(explicitChoice.current.binding)) explicitChoice.current = null;
      if (signedOut || confirmedScope.current && !compatible(confirmedScope.current)) confirmedScope.current = null;
      scope.current = unknown;
      preferences.current = { ...emptyPreferences(), explicit: explicitChoice.current?.locale ?? null, acceptLanguage: browserLanguage() };
      setView(previous => explicitChoice.current ? { ...previous, status: "checking", ready: false } : { ...initialView, status: "checking" });
      let owner: string | null | undefined = signedOut ? null : undefined;
      try {
        if (!signedOut) {
          const { response, value } = await request("/api/auth/session");
          if (response.status === 401) owner = null;
          else {
            if (!response.ok) throw new Error("Session unavailable");
            const session = (value as { session?: { address?: unknown } } | null)?.session;
            const resolved = canonicalLocaleOwner(session?.address);
            if (!resolved) throw new Error("Session unavailable");
            if (connectedWallet && canonicalLocaleOwner(connectedWallet) !== resolved) throw new Error("Wallet changed");
            owner = resolved;
          }
        }
      } catch { owner = undefined; }
      if (!live || !epoch.current.current(ticket)) return;
      if (owner === undefined) {
        // No durable namespace is bound until session identity is confirmed.
        await renderPreference(ticket, "unavailable");
        return;
      }
      const binding: LocaleScope = { origin, network, owner };
      if (explicitChoice.current) {
        const previous = explicitChoice.current.binding;
        if (!sameRealm(previous, binding) || previous.owner !== undefined && !sameBinding(previous, binding)) explicitChoice.current = null;
        // A choice made before the first session reply remains current intent.
        // Bind it once in memory; resolving identity grants no persistence/write.
        else explicitChoice.current = { ...explicitChoice.current, binding };
      }
      scope.current = binding;
      confirmedScope.current = binding;
      preferences.current = { ...emptyPreferences(), explicit: explicitChoice.current?.locale ?? null,
        browser: readBrowserLocale(() => window.localStorage, binding), acceptLanguage: browserLanguage() };
      await renderPreference(ticket, null);
      if (!owner || !epoch.current.current(ticket)) return;
      try {
        const { response, value } = await request("/api/me/locale-preference", { headers: {
          "X-Keryx-Expected-Wallet": owner, "X-Keryx-Locale-Network": network,
        } });
        const reply = response.ok ? parseLocaleReply(value, binding) : null;
        if (!reply) throw new Error("Account preference unavailable");
        if (!live || !epoch.current.current(ticket)) return;
        preferences.current.account = reply.locale;
        preferences.current.acceptLanguage = reply.acceptLanguage ?? preferences.current.acceptLanguage;
        await renderPreference(ticket, null);
      } catch {
        if (live && epoch.current.current(ticket)) setView(previous => ({ ...previous, status: "unavailable" }));
      }
    };
    const changed = (event: Event) => { void refresh((event as CustomEvent).detail === "signed-out"); };
    const focused = () => { void refresh(); };
    const stored = (event: StorageEvent) => {
      const binding = scope.current;
      if (binding && binding.owner !== undefined && (event.key === null || event.key === localeScopeKey({ ...binding, owner: binding.owner }))) void refresh();
    };
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("keryx-auth-v1"); channel.onmessage = event => { void refresh(event.data === "signed-out"); }; } catch {}
    window.addEventListener("keryx:auth", changed); window.addEventListener("focus", focused); window.addEventListener("storage", stored);
    void refresh();
    return () => {
      live = false; lifecycleEpoch.invalidate(); scope.current = null;
      for (const controller of pendingRequests) controller.abort();
      channel?.close(); window.removeEventListener("keryx:auth", changed); window.removeEventListener("focus", focused); window.removeEventListener("storage", stored);
    };
  }, [request, renderPreference, network, connectedWallet, enabledKey]);

  const selectLocale = useCallback((locale: UiLocale) => {
    const binding = scope.current;
    if (!binding || binding.network !== activeRealm.current.network ||
      binding.origin !== window.location.origin ||
      binding.owner && activeRealm.current.connectedWallet && binding.owner !== canonicalLocaleOwner(activeRealm.current.connectedWallet) || !enabled.current.includes(locale)) return;
    const ticket = epoch.current.invalidate();
    // Retain an outage choice for the last confirmed identity or observed wallet.
    // A first unknown choice binds on resolution, without reading/writing a scope
    // until the session confirms it. Later owner/realm changes still clear it.
    const observedOwner = canonicalLocaleOwner(activeRealm.current.connectedWallet);
    explicitChoice.current = { binding: binding.owner === undefined ?
      observedOwner ? { ...binding, owner: observedOwner } : confirmedScope.current ?? binding : binding, locale };
    preferences.current.explicit = locale;
    const durableBinding = binding.owner === undefined ? null : { ...binding, owner: binding.owner };
    const saved = durableBinding ? writeBrowserLocale(() => window.localStorage, durableBinding, locale) : false;
    if (durableBinding) preferences.current.browser = locale;
    const rendering = renderPreference(ticket, saved ? binding.owner ? "saving" : "browserSaved" : "memoryOnly");
    if (!durableBinding?.owner) return;
    // Serialize actual PUTs. A superseded queued choice is discarded before transport.
    writeQueue.current = writeQueue.current.catch(() => {}).then(async () => {
      await rendering;
      if (!epoch.current.current(ticket) || scope.current !== binding) return;
      try {
        const { response, value } = await request("/api/me/locale-preference", { method: "PUT", headers: {
          "Content-Type": "application/json", "X-Keryx-Expected-Wallet": durableBinding.owner!, "X-Keryx-Locale-Network": durableBinding.network,
        }, body: JSON.stringify({ version: 1, locale }) });
        const reply = response.ok ? parseLocaleReply(value, durableBinding) : null;
        if (!reply || reply.locale !== locale) throw new Error("Account write unavailable");
        if (epoch.current.current(ticket) && scope.current === binding) {
          preferences.current.account = locale;
          setView(previous => ({ ...previous, status: previous.status === "loadFailed" ? previous.status : "accountSaved" }));
        }
      } catch {
        if (epoch.current.current(ticket) && scope.current === binding) setView(previous => ({ ...previous, status: saved ? "unavailable" : "memoryOnly" }));
      }
    });
  }, [renderPreference, request]);

  useEffect(() => {
    document.documentElement.lang = view.locale;
    document.documentElement.dir = localeDirection(view.locale);
  }, [view.locale]);

  return <LocaleContext.Provider value={{ ...view, enabledLocales, message: createShellMessages(view.locale, view.catalogue), selectLocale }}>
    {/* Unmigrated route content remains English. Shell boundaries set their own active language. */}
    <div lang="en" className="contents">{children}</div>
  </LocaleContext.Provider>;
}
export function useLocale() { return useContext(LocaleContext); }
