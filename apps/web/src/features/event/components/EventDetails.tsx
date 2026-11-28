"use client";

import { EventDetailsView } from "@/components/EventDetailsView";

import type { KickbackEvent } from "../api/useEvent";
import { useEventDetails } from "../hooks/useEventDetails";

export function EventDetails({ event, ended }: { event: KickbackEvent; ended?: boolean }) {
  const model = useEventDetails(event);
  return <EventDetailsView {...model} ended={ended} />;
}
