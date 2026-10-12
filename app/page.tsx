import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ResearchChat } from "@/components/keryx/research-chat";
import { ActivityTicker } from "@/components/keryx/activity-ticker";
import { HowItWorks, ForCreators } from "@/components/keryx/landing-sections";
import { walkthroughMessages } from "@/locales/en/walkthrough";
import { LandingVisit } from "@/components/keryx/landing-visit";
import { ProductOverview, ProductProof, ProductFaq } from "@/components/keryx/product-guide";

export default function AskPage() {
  return <div className="min-h-screen bg-paper-2">
    <LandingVisit />
    <SiteHeader />
    <main>
      <div className="mx-auto max-w-[960px] px-4 sm:px-[30px] sm:pt-5">
        <Link href="/walkthrough" prefetch={false} className="text-sm text-paid underline underline-offset-4">{walkthroughMessages.landingLink}</Link>
      </div>
      <ResearchChat showLaunchBadge introduceProduct />
      <div className="mx-auto max-w-[960px] px-4 sm:px-[30px]"><ActivityTicker /></div>
      <ProductOverview />
      <HowItWorks />
      <ProductProof />
      <ForCreators />
      <ProductFaq />
    </main>
    <SiteFooter />
  </div>;
}
