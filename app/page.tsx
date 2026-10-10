"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ResearchChat } from "@/components/keryx/research-chat";
import { ActivityTicker } from "@/components/keryx/activity-ticker";
import { HowItWorks, ForCreators } from "@/components/keryx/landing-sections";
import { walkthroughMessages } from "@/locales/en/walkthrough";

export default function AskPage() {
  // One coarse landing event per tab/day. No stable id is created and credentials are omitted, so
  // the server receives only the allowlisted event name and increments a UTC-day counter.
  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10);
    const key = `keryx:activation:landing:${day}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "pending");
      void fetch("/api/activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "reader_landing" }),
        credentials: "omit",
        keepalive: true,
      }).then((response) => {
        if (response.ok) window.sessionStorage.setItem(key, "1");
        else window.sessionStorage.removeItem(key);
      }).catch(() => window.sessionStorage.removeItem(key));
    } catch {
      // Storage disabled or telemetry unavailable: the product remains fully functional.
    }
  }, []);

  return <div className="min-h-screen bg-paper-2"><SiteHeader /><main><div className="mx-auto max-w-[960px] px-4 sm:px-[30px] sm:pt-5"><Link href="/walkthrough" prefetch={false} className="text-sm text-paid underline underline-offset-4">{walkthroughMessages.landingLink}</Link></div><ResearchChat showLaunchBadge /><div className="mx-auto max-w-[960px] px-4 sm:px-[30px]"><ActivityTicker /></div><HowItWorks /><ForCreators /></main><SiteFooter /></div>;
}
