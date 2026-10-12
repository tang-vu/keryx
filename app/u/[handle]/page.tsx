import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicProfile } from "@/lib/profiles/public-profile-loader";
import { PublicResearcherProfile } from "@/components/keryx/public-researcher-profile";
import { SiteHeader } from "@/components/keryx/site-header";
import { safeInlineJson } from "@/lib/safe-json";
export const dynamic="force-dynamic";
export const revalidate=0;
type Props={params:Promise<{handle:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{
  const profile=await loadPublicProfile((await params).handle);if(!profile)return {title:"Profile unavailable",robots:{index:false,follow:false}};
  const title=profile.displayName||`@${profile.handle}`,description=profile.purpose||profile.about||"Selected public research on Keryx.";
  return {title,description,alternates:{canonical:`/u/${profile.handle}`,types:{"application/json":`/api/u/${profile.handle}`}},
    openGraph:{title,description,type:"profile",url:`/u/${profile.handle}`,images:[`/u/${profile.handle}/opengraph-image`]},
    twitter:{card:"summary_large_image",title,description,images:[`/u/${profile.handle}/opengraph-image`]}};
}
export default async function Page({params}:Props){
  const profile=await loadPublicProfile((await params).handle);if(!profile)notFound();
  const base=process.env.BASE_URL||"https://keryx.cc";
  const data={"@context":"https://schema.org","@type":"ProfilePage",url:`${base}/u/${profile.handle}`,
    mainEntity:{"@type":"Person",name:profile.displayName||profile.handle,description:profile.about,
      sameAs:profile.verifiedLinks?.map(link=>link.url)}};
  return <><SiteHeader/><script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeInlineJson(data)}}/><PublicResearcherProfile profile={profile}/></>;
}
