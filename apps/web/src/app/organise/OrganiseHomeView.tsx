"use client";

import { EventsList, listedEvents } from "@/features/event";
import { OrganiseHome } from "@/features/organise";

import { paths } from "@/config/paths";

import { organiserStatus } from "../_home/organiserStatus";

/** "Manage your events", with each event's row as on the home page: name, date, deposit, phase and deposits. */
export function OrganiseHomeView() {
  return (
    <OrganiseHome
      renderEvents={(events) => (
        <EventsList
          rows={listedEvents(
            events.map((row) => ({ contract: row.contract })),
            Infinity,
          )}
          hrefOf={(row) => paths.organiseEvent.getHref(row.contract)}
          statusOf={organiserStatus}
        />
      )}
    />
  );
}
