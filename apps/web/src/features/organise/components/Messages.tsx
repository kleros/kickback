"use client";

import { ErrorLine } from "./parts";
import type { OrganiserEvent } from "../hooks/useOrganiserEvent";

/** The tab's last send: what went wrong, or what was confirmed. */
export function Messages({ event }: { event: Pick<OrganiserEvent, "error" | "done"> }) {
  return (
    <>
      <ErrorLine error={event.error} />
      {event.done && (
        <p className="og-success" role="status" data-testid="done">
          {event.done}
        </p>
      )}
    </>
  );
}
