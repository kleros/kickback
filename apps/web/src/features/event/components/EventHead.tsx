import type { EventClock } from "@kickback/core";

import { eventDateText } from "../model/when";

export function EventHead({ name, eventStart, clock }: { name: string; eventStart: number; clock: EventClock | null }) {
  return (
    <div className="ev-head">
      <h1 className="ev-title">{name}</h1>
      <p className="ev-when">
        <time dateTime={new Date(eventStart * 1000).toISOString()} data-testid="event-when">
          {eventDateText(eventStart, clock)}
        </time>
      </p>
    </div>
  );
}
