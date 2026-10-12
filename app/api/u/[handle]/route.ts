import { getDb } from "@/lib/db";
import { readPublicProfileJson, publicProfileFailure } from "@/lib/profiles/public-profile-route";
import { publicHandle, publicProfilesEnabled, PublicProfileError } from "@/lib/profiles/public-profile";
import { authJson } from "@/lib/auth-challenge";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;
export async function GET(_req:Request,context:{params:Promise<{handle:string}>}){
  const handle=(await context.params).handle,parsed=publicHandle.safeParse(handle);
  if(!parsed.success||parsed.data!==handle)return authJson({error:"not_found"},404);
  if(!publicProfilesEnabled(process.env))return publicProfileFailure(new PublicProfileError("public_profile_unavailable"));
  try{return await readPublicProfileJson(await getDb(),handle);}catch(error){return publicProfileFailure(error);}
}
