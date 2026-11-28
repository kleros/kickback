import { eventDateText, type EventClock } from "../model/when";

/** "Wed 4 Nov 2026, 18:00 – 22:00 GMT+5:30", or both dates when it runs past midnight. */
function rangeText(start: number, end: number, clock: EventClock | null) {
  const a = eventDateText(start, clock);
  const b = eventDateText(end, clock);
  const day = (t: string) => t.split(",")[0];
  const time = (t: string) => t.split(", ")[1] ?? t;
  // every date text ends with its zone: show it once, after the end time
  return day(a) === day(b) ? `${a.replace(/ \S+$/, "")} – ${time(b)}` : `${a} – ${b}`;
}

export function EventHead({
  name,
  eventStart,
  eventEnd,
  clock,
}: {
  name: string;
  eventStart: number;
  eventEnd?: number;
  clock: EventClock | null;
}) {
  return (
    <div className="ev-head">
      <h1 className="ev-title">{name}</h1>
      <p className="ev-when">
        <time dateTime={new Date(eventStart * 1000).toISOString()} data-testid="event-when">
          {eventEnd ? rangeText(eventStart, eventEnd, clock) : eventDateText(eventStart, clock)}
        </time>
      </p>
    </div>
  );
}
