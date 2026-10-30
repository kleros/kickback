import type { Metadata } from "next";

import { EventScreen } from "@/features/event";

export const metadata: Metadata = {
  title: "Event | Kickback",
};

export default function EventPage({
  params,
  searchParams,
}: {
  params: { contract: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const from = searchParams.from;
  return <EventScreen contract={decodeURIComponent(params.contract)} from={Array.isArray(from) ? from[0] : from} />;
}
