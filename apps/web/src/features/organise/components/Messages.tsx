"use client";

import { ErrorLine, TxLink } from "./parts";
import type { OrganiserEvent } from "../hooks/useOrganiserEvent";

/** The tab's last send: what went wrong, what is still confirming, or what was confirmed (with its transaction). */
export function Messages({
  event,
}: {
  event: Pick<OrganiserEvent, "error" | "done"> & Partial<Pick<OrganiserEvent, "doneTx" | "pending">>;
}) {
  return (
    <>
      <ErrorLine error={event.error} />
      {event.pending && (
        <p className="og-note" role="status" data-testid="pending">
          {event.pending.text}
        </p>
      )}
      {event.done && (
        <p className="og-success" role="status" data-testid="done">
          {event.done}
          {event.doneTx && (
            <>
              {" "}
              Transaction <TxLink tx={event.doneTx} testId="done-tx" />.
            </>
          )}
        </p>
      )}
    </>
  );
}
