import { ImageResponse } from "next/og";
import { publicProfileCopy as copy } from "@/locales/en/public-profiles";
import { loadPublicProfile } from "@/lib/profiles/public-profile-loader";
import { publicPreviewFonts, publicPreviewFontFamily } from "@/lib/og-fonts";
import { publicPreviewFittedText } from "@/lib/og-text";
import type { PublicProfileSnapshot } from "@/lib/profiles/public-profile";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;
export const size={width:1200,height:630};
export const contentType="image/png";
export const alt=copy.imageAlt;
function displayedText(profile:PublicProfileSnapshot){
  return [`${copy.brand} · @${profile.handle}`,profile.displayName||profile.handle,
    profile.purpose||profile.about||copy.selectedResearch,copy.imageOwnership].join("\n");
}
export default async function Image({params}:{params:Promise<{handle:string}>}){
  const {handle}=await params;
  const candidate=await loadPublicProfile(handle);
  if(!candidate)return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
  const text=displayedText(candidate);
  const [fonts,name,purpose]=await Promise.all([
    publicPreviewFonts(text),
    publicPreviewFittedText(candidate.displayName||candidate.handle,{fontSize:64,maxWidth:1060,maxHeight:160,color:"#26261f"}),
    publicPreviewFittedText(candidate.purpose||candidate.about||copy.selectedResearch,{fontSize:30,maxWidth:1060,maxHeight:140,color:"#26261f"}),
  ]);
  // Neither fonts nor shaping confer publication authority. Recheck after ALL
  // awaited preparation; withdrawal or changed displayed text refuses the card.
  const profile=await loadPublicProfile(handle);
  if(!profile||displayedText(profile)!==text)return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
  return new ImageResponse(<div style={{display:"flex",flexDirection:"column",justifyContent:"center",padding:70,width:"100%",height:"100%",background:"#f1e9d7",color:"#26261f",fontFamily:publicPreviewFontFamily}}>
    <div style={{display:"flex",fontSize:28,flexShrink:0}}>{copy.brand} · @{profile.handle}</div><div style={{display:"flex",marginTop:28,flexShrink:0}}>{name}</div>
    <div style={{display:"flex",marginTop:28,flexShrink:0}}>{purpose}</div>
    <div style={{display:"flex",fontSize:22,marginTop:40,flexShrink:0}}>{copy.imageOwnership}</div>
  </div>,{...size,fonts,headers:{"Cache-Control":"no-store"}});
}
