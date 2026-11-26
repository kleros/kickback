"use client";

import { useAccount } from "wagmi";

import { EventsList, listedEvents } from "@/features/event";
import { useMyEvents } from "@/features/organise";

/**
 * No public or featured events: Kickback is a tool, not a listing, and guests arrive from Luma.
 * A connected wallet sees the events it created, as its own record.
 */
export function HomeEvents() {
  const { address } = useAccount();
  const mine = useMyEvents();
  const rows = address ? listedEvents((mine.data ?? []).map((row) => ({ contract: row.contract }))) : [];
  return (
    <>
      <p className="home-empty">No featured events yet. Guests find each event on Luma.</p>
      {rows.length > 0 && <EventsList rows={rows} />}
    </>
  );
}
