import { isShowableTime, zonedDateText } from "@/utils/time";

import type { EventClock } from "@/lib/presence";

export { isShowableTime };

export type { EventClock };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The wall clock at the event: a Date read with getUTC*. */
const atEvent = (unix: number, clock: EventClock) => new Date((unix + clock.offset * 60) * 1000);

const OUT_OF_RANGE = "Date not available";

/** "Wed 4 Nov 2026, 18:00 IST" on the event's own clock, or the visitor's when the event names none. */
export function eventDateText(unix: number, clock: EventClock | null, timeZone?: string): string {
  if (!isShowableTime(unix)) return OUT_OF_RANGE;
  if (!clock) return zonedDateText(unix, timeZone);
  const d = atEvent(unix, clock);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${clock.zone}`;
}

/** "Wed 4 Nov, 18:00 IST": a deadline on the event's clock, without the year unless it is another year. */
export function deadlineText(
  unix: number,
  clock: EventClock | null,
  timeZone?: string,
  nowUnix = Date.now() / 1000,
): string {
  const text = eventDateText(unix, clock, timeZone);
  if (!isShowableTime(unix)) return text;
  const year = text.match(/ (\d{4}),/)?.[1];
  const thisYear = eventDateText(nowUnix, clock, timeZone).match(/ (\d{4}),/)?.[1];
  return year && year === thisYear ? text.replace(/ \d{4},/, ",") : text;
}

/** "29 Oct" on the event's clock. */
export function dayText(unix: number, clock: EventClock | null, timeZone?: string): string {
  if (!isShowableTime(unix)) return OUT_OF_RANGE;
  if (!clock)
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(new Date(unix * 1000));
  const d = atEvent(unix, clock);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Wed 4 Nov, 13:30" in the visitor's own zone. */
export function visitorText(unix: number, timeZone?: string): string {
  if (!isShowableTime(unix)) return OUT_OF_RANGE;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  })
    .format(new Date(unix * 1000))
    .replace(/^(\w+),? /, "$1 ")
    .replace(/ at /, ", ");
}

/** True when the visitor's clock reads the same as the event's, so their time need not be shown twice. */
export function sameClock(unix: number, clock: EventClock | null, timeZone?: string): boolean {
  if (!clock || !isShowableTime(unix)) return true;
  const visitorOffset = -new Date(unix * 1000).getTimezoneOffset();
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(
      new Date(unix * 1000),
    );
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
    const offset = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
    return offset === clock.offset;
  }
  return visitorOffset === clock.offset;
}
