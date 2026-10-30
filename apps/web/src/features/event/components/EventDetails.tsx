"use client";

import { EventDetailsView } from "@/components/EventDetailsView";

import type { KickbackEvent } from "../api/useEvent";
import { useEventDetails } from "../hooks/useEventDetails";

export function EventDetails({ event }: { event: KickbackEvent }) {
  const model = useEventDetails(event);
  return <EventDetailsView {...model} />;
}
