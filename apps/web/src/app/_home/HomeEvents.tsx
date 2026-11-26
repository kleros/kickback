"use client";

import { EventsList, listedEvents, useLatestEvents } from "@/features/event";

/** The featured organisers' newest events: public, the same for every visitor, connected or not. */
export function HomeEvents() {
  const latest = useLatestEvents(6);
  const rows = listedEvents(
    (latest.data ?? []).map((contract) => ({ contract })),
    [],
  );
  return <EventsList rows={rows} />;
}
