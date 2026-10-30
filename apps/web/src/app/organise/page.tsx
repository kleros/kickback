import type { Metadata } from "next";

import { OrganiseHome } from "@/features/organise";

export const metadata: Metadata = {
  title: "Organise | Kickback",
};

export default function OrganisePage() {
  return <OrganiseHome />;
}
