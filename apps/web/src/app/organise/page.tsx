import type { Metadata } from "next";

import { OrganiseHome } from "@/features/organise";

export const metadata: Metadata = {
  title: "Manage your events | Kickback",
};

export default function OrganisePage() {
  return <OrganiseHome />;
}
