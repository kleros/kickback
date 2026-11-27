import type { Metadata } from "next";
import type { ReactNode } from "react";

import type { Address } from "viem";

import { OrganiserShell } from "@/features/organise";

import { cleanEventParam } from "@/lib/eventParam";

export const metadata: Metadata = {
  title: "Manage event | Kickback",
};

export default function OrganiserLayout({ params, children }: { params: { contract: string }; children: ReactNode }) {
  return <OrganiserShell address={cleanEventParam(params.contract) as Address}>{children}</OrganiserShell>;
}
