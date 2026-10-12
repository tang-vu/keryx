import { ImageResponse } from "next/og";
import { loadPublicProfile } from "@/lib/profiles/public-profile-loader";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;
export const size={width:1200,height:630};
export const contentType="image/png";
export const alt="Opt-in Keryx researcher profile";
export default async function Image({params}:{params:Promise<{handle:string}>}){
  const profile=await loadPublicProfile((await params).handle);
  if(!profile)return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
  return new ImageResponse(<div style={{display:"flex",flexDirection:"column",justifyContent:"center",padding:70,width:"100%",height:"100%",background:"#f1e9d7",color:"#26261f"}}>
    <div style={{display:"flex",fontSize:28}}>KERYX · @{profile.handle}</div><div style={{display:"flex",fontSize:64,marginTop:28}}>{profile.displayName||profile.handle}</div>
    <div style={{display:"flex",fontSize:30,marginTop:28}}>{profile.purpose||profile.about||"Selected public research"}</div>
    <div style={{display:"flex",fontSize:22,marginTop:40}}>Owner-published research profile</div>
  </div>,{...size,headers:{"Cache-Control":"no-store"}});
}
