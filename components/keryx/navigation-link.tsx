"use client";

import type { ComponentProps } from "react";
import { createPortal } from "react-dom";
import Link, { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { webHeaderMessages } from "@/locales/en/web-header";

function NavigationStatus() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  // The portal escapes the sticky header's backdrop filter and mobile menu's
  // clipping. Next owns pending: completion, cancellation and supersession all
  // clear it without timers or intercepting the browser's link behavior.
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100]" data-navigation-pending>
      <div className="h-1 bg-seal/20" aria-hidden="true">
        <div className="h-full w-2/3 bg-seal motion-safe:animate-pulse" />
      </div>
      <div role="status" className="absolute right-4 top-20 flex items-center gap-3 border border-line bg-paper px-4 py-3 font-mono text-sm text-ink shadow-lg">
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        {webHeaderMessages["shellHeader.loadingPage"]}
      </div>
    </div>,
    document.body,
  );
}

/** Keep automatic prefetching; also acknowledge clicks before it has finished. */
export function NavigationLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<NavigationStatus /></Link>;
}
