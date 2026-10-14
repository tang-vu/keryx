import type { Metadata } from "next";
import { AccountMembershipWorkspace } from "@/components/keryx/account-membership-workspace";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AccountPage() { return <AccountMembershipWorkspace />; }
