"use client";

import { useLayoutEffect } from "react";
import { useUiMessages } from "../i18n/ui-copy";

interface EditorGuards {
  messages: Map<symbol, string>;
  dispose(): void;
}
const documents = new WeakMap<Document, EditorGuards>();

/** One document listener serves independent editors, including hidden forms.
 * It retains only dirty registrations and fixed copy, never their private text. */
function registerEditor(document: Document, message: string): (() => void) | undefined {
  const view = document.defaultView;
  if (!view) return;
  let state = documents.get(document);
  if (!state) {
    const messages = new Map<symbol, string>();
    let approved: Set<symbol> | undefined, timer: number | undefined;
    const resetApproval = () => {
      approved = undefined;
      if (timer !== undefined) view.clearTimeout(timer);
      timer = undefined;
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!messages.size) return;
      // A confirmed native link must not ask twice. Consent lasts only for this
      // click task and only for the editors present when the user confirmed it.
      if (approved && [...messages.keys()].every(key => approved!.has(key))) { resetApproval(); return; }
      resetApproval(); event.preventDefault(); event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      if (!messages.size || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || link.target && link.target.toLowerCase() !== "_self") return;
      let target: URL;
      try { target = new URL(link.href, view.location.href); } catch { return; }
      if (target.origin !== view.location.origin || target.pathname === view.location.pathname && target.search === view.location.search) return;
      resetApproval();
      let accepted = false;
      try { accepted = view.confirm(messages.values().next().value!); } catch { /* An unavailable prompt cannot discard edits. */ }
      if (!accepted) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      approved = new Set(messages.keys());
      // A client transition may fail or be prevented by another handler. Never
      // leave a lasting exemption from the ordinary reload/close warning.
      timer = view.setTimeout(resetApproval, 0);
    };
    document.addEventListener("click", navigate, true);
    view.addEventListener("beforeunload", unload);
    state = { messages, dispose() {
      resetApproval(); document.removeEventListener("click", navigate, true); view.removeEventListener("beforeunload", unload);
    } };
    documents.set(document, state);
  }
  const key = Symbol("unsaved-editor"), current = state;
  current.messages.set(key, message);
  return () => {
    current.messages.delete(key);
    if (!current.messages.size) { current.dispose(); if (documents.get(document) === current) documents.delete(document); }
  };
}

/** Protect ordinary same-tab links plus native reload/close. Does not patch
 * browser history/router APIs or add storage, recovery or network requests. */
export function useUnsavedNavigation(dirty: boolean): void {
  const copy = useUiMessages();
  useLayoutEffect(() => {
    if (dirty) return registerEditor(document, copy("unsavedNavigation.confirm"));
  }, [dirty, copy]);
}
