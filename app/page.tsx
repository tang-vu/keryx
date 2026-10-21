import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ResearchChat } from "@/components/keryx/research-chat";
import { ActivityTicker } from "@/components/keryx/activity-ticker";
import { HowItWorks, ForCreators } from "@/components/keryx/landing-sections";
import { LandingVisit } from "@/components/keryx/landing-visit";
import { ProductProof, ProductFaq } from "@/components/keryx/product-guide";
import { ProductHuntBadge } from "@/components/keryx/product-hunt-badge";
import { ResearchResources } from "@/components/keryx/research-resources";



export default function AskPage() {
  return <div className="min-h-screen bg-paper-2">
    <LandingVisit />
    <SiteHeader />
    <main>
      <ResearchChat introduceProduct />
      <HowItWorks />
      <div className="mx-auto max-w-[960px] px-4 sm:px-[30px]">
        <ActivityTicker />
        <div className="mt-3"><ProductHuntBadge /></div>
      </div>
      <ProductProof />
      <ResearchResources />
      <ForCreators />
      <ProductFaq />
    </main>
    <SiteFooter />
  </div>;
}
