"use client";

import { useEffect, useState } from "react";

import { fillShare } from "@kickback/core";

import { paths } from "@/config/paths";

import { eventDetails } from "./useEventDetails";
import type { KickbackEvent } from "../api/useEvent";
import { lumaShareLink } from "../model/socialShare";
import { eventDateText } from "../model/when";

export function useReceiptShare(event: KickbackEvent, from?: string) {
  const details = eventDetails(event);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const guestLink = `${origin}${paths.event.getHref(event.contract, from)}`;
  const luma = lumaShareLink(details.link) || lumaShareLink(event.lumaUrl);
  const text = fillShare(undefined, {
    event: event.eventName,
    date: eventDateText(event.eventStart, event.clock),
    venue: "",
    luma,
    guestLink,
  });
  return { text, luma, guestLink };
}
