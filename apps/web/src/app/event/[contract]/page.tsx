import type { Metadata } from "next";

import { EventScreen } from "@/features/event";
import { eventCardMetadata } from "@/features/event/operations/openGraph";
import { serverEventCard } from "@/features/event/operations/serverEventCard";

export async function generateMetadata({ params }: { params: { contract: string } }): Promise<Metadata> {
  return eventCardMetadata(await serverEventCard(params.contract), params.contract);
}

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
