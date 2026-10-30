import type { Metadata } from "next";
import type { ReactNode } from "react";

import type { Address } from "viem";

import { OrganiserShell } from "@/features/organise";

export const metadata: Metadata = {
  title: "Organise | Kickback",
};

export default function OrganiserLayout({ params, children }: { params: { contract: string }; children: ReactNode }) {
  return <OrganiserShell address={decodeURIComponent(params.contract) as Address}>{children}</OrganiserShell>;
}
