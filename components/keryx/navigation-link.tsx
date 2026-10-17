"use client";

import { useEffect, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import Link, { useLinkStatus } from "next/link";
import { PageLoadingContent } from "./page-loading-content";

function NavigationStatus() {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    // Covered content must also stop accepting keyboard and assistive-technology
    // interaction. Keep the header available for replacement navigation.
    const covered = [...document.querySelectorAll<HTMLElement>("main, footer")]
      .map(element => ({ element, inert: element.inert }));
    for (const { element } of covered) element.inert = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      for (const { element, inert } of covered) element.inert = inert;
      document.body.style.overflow = overflow;
    };
  }, [pending]);
  if (!pending) return null;

  // The portal escapes the sticky header's backdrop filter and mobile menu's
  // clipping. Next owns pending: completion, cancellation and supersession all
  // clear it without timers or intercepting the browser's link behavior.
  return createPortal(
    <div className="fixed inset-x-0 bottom-0 top-[67px] z-40 overflow-y-auto bg-paper-2" data-navigation-pending>
      <PageLoadingContent />
    </div>,
    document.body,
  );
}

/** Keep automatic prefetching; also acknowledge clicks before it has finished. */
export function NavigationLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<NavigationStatus /></Link>;
}
