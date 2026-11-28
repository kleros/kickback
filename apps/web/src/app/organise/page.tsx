import type { Metadata } from "next";

import { OrganiseHomeView } from "./OrganiseHomeView";

export const metadata: Metadata = {
  title: "Manage your events | Kickback",
};

export default function OrganisePage() {
  return <OrganiseHomeView />;
}
