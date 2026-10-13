import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createPublicProfileOwnerRoutes } from "@/lib/profiles/public-profile-route";
import { publicProfilesEnabled, PublicProfileError } from "@/lib/profiles/public-profile";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const routes=createPublicProfileOwnerRoutes({session:async()=>{
  if(!publicProfilesEnabled(process.env))throw new PublicProfileError("public_profile_unavailable");
  return accountSessionContext();
},binding:{network:config.networkId as "eip155:5042"|"eip155:5042002",origin:new URL(process.env.BASE_URL||"https://keryx.cc").origin}});
export const GET=routes.GET;
export const PUT=routes.PUT;
export const DELETE=routes.DELETE;
