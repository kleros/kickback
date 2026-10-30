import Link from "next/link";

import { paths } from "@/config/paths";

import type { BrowserDeployment } from "../model/create";

/** Events this browser created: a convenience list, read from local storage only. */
export function BrowserEvents({ events }: { events: readonly BrowserDeployment[] }) {
  if (!events.length) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="browser-events">
      <h2 className="og-h2">Created from this browser</h2>
      <ul className="og-events">
        {events.map((row) => (
          <li key={`${row.chainId}:${row.address}`} className="og-event-row">
            <span>{row.name}</span>
            <Link className="kb-link" href={paths.organiseEvent.getHref(row.address, row.block)}>
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
