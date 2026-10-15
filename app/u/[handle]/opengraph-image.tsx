import { ImageResponse } from "next/og";
import { publicProfileCopy as copy } from "@/locales/en/public-profiles";
import { loadPublicProfile } from "@/lib/profiles/public-profile-loader";
import { publicPreviewFonts, publicPreviewFontFamily } from "@/lib/og-fonts";
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
  const fonts=await publicPreviewFonts(text);
  // Font I/O is not publication authority. Recheck the actual public projection
  // after that await; withdrawal or changed displayed text refuses the old card.
  const profile=await loadPublicProfile(handle);
  if(!profile||displayedText(profile)!==text)return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
  return new ImageResponse(<div style={{display:"flex",flexDirection:"column",justifyContent:"center",padding:70,width:"100%",height:"100%",background:"#f1e9d7",color:"#26261f",fontFamily:publicPreviewFontFamily}}>
    <div style={{display:"flex",fontSize:28}}>{copy.brand} · @{profile.handle}</div><div style={{display:"flex",fontSize:64,marginTop:28}}>{profile.displayName||profile.handle}</div>
    <div style={{display:"flex",fontSize:30,marginTop:28}}>{profile.purpose||profile.about||copy.selectedResearch}</div>
    <div style={{display:"flex",fontSize:22,marginTop:40}}>{copy.imageOwnership}</div>
  </div>,{...size,fonts,headers:{"Cache-Control":"no-store"}});
}
