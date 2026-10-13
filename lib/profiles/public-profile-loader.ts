import { getDb } from "../db";
import { publicHandle, publicProfilesEnabled, requirePublicProfiles } from "./public-profile";
/** Deliberately uncached: every page, JSON, image and sitemap request rechecks publication. */
export async function loadPublicProfile(handle:string){
  const parsed=publicHandle.safeParse(handle);if(!parsed.success||parsed.data!==handle)return null;
  if(!publicProfilesEnabled(process.env))return null;
  try{return await requirePublicProfiles(await getDb()).read(handle);}catch{return null;}
}
export async function publicProfileSitemap(){
  if(!publicProfilesEnabled(process.env))return [];
  try{return await requirePublicProfiles(await getDb()).sitemap(1000);}catch{return [];}
}
