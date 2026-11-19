"use client";

import { EventsList, listedEvents, useLatestEvents } from "@/features/event";
import { useBrowserEvents } from "@/features/organise";

/** The factory's newest events, then the events created from this browser. */
export function HomeEvents() {
  const latest = useLatestEvents(6);
  const rows = listedEvents((latest.data ?? []).map((contract) => ({ contract })), useBrowserEvents());
  return <EventsList rows={rows} />;
}
