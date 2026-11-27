import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EventScreen } from "@/features/event";
import { eventCardMetadata } from "@/features/event/operations/openGraph";
import { serverEventCard } from "@/features/event/operations/serverEventCard";

import { cleanEventParam, decodeParam } from "@/lib/eventParam";

import { paths } from "@/config/paths";

export async function generateMetadata({ params }: { params: { contract: string } }): Promise<Metadata> {
  const contract = cleanEventParam(params.contract);
  return eventCardMetadata(await serverEventCard(contract), contract);
}

export default function EventPage({
  params,
  searchParams,
}: {
  params: { contract: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const fromParam = searchParams.from;
  const from = Array.isArray(fromParam) ? fromParam[0] : fromParam;
  const contract = cleanEventParam(params.contract);
  // a link copied with a trailing space or full stop opens the event, under its clean address
  if (contract !== decodeParam(params.contract)) redirect(paths.event.getHref(contract, from));
  return <EventScreen contract={contract} from={from} />;
}
