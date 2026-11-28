import type { Metadata } from "next";

import { CreateScreen } from "@/features/organise";

export const metadata: Metadata = {
  title: "Create an event | Kickback",
};

export default function NewEventPage() {
  return <CreateScreen />;
}
