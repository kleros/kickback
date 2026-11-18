"use client";

import { EventsList, listedEvents } from "@/features/event";
import { useBrowserEvents } from "@/features/organise";

import { DEFAULT_EVENT } from "@/config/event";

/** The network's featured event, then the events created from this browser. */
export function HomeEvents() {
  return <EventsList rows={listedEvents([DEFAULT_EVENT], useBrowserEvents())} />;
}
