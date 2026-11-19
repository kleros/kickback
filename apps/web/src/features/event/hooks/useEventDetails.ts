"use client";

import { useEffect, useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { visibleLink, type EventDetailsData } from "@/lib/event-details";

import type { KickbackEvent } from "../api/useEvent";
import { fetchRegistrationPreview } from "../info/presentation";
import { contractTint } from "../model/eventDetails";
import { eventDateText } from "../model/when";

/** The event as the contract describes it: its name, dates and link. */
export function eventDetails(event: KickbackEvent): EventDetailsData {
  return {
    title: event.eventName,
    name: event.eventName,
    when: eventDateText(event.eventStart, event.clock),
    where: null,
    hosts: [],
    link: event.url || event.lumaUrl || null,
  };
}

export function useEventDetails(event: KickbackEvent) {
  const details = useMemo(() => eventDetails(event), [event]);
  const link = visibleLink(details.link);
  const preview = useQuery({
    queryKey: ["registration-preview", link?.href],
    queryFn: () => fetchRegistrationPreview(link!.href),
    enabled: !!link,
    staleTime: 60 * 60_000,
    retry: false,
  });
  const tint = contractTint(event.contract);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--kb-route-tint", tint);
    return () => {
      root.style.removeProperty("--kb-route-tint");
    };
  }, [tint]);
  return {
    // the head above already shows the name and date; the section adds the registration page
    details: { ...details, title: null, when: null },
    description: "",
    links: [],
    coverUrl: undefined,
    preview: preview.data,
    tint,
  };
}
