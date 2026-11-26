/** JS dates stop at ±8.64e15 ms; a contract can hold any uint64, so check a unix time before formatting it. */
export const isShowableTime = (unix: number) => Number.isFinite(unix) && Math.abs(unix) <= 8.64e12;

const DAY = 86_400;

/** "1 day", "2 days", "12 hours", "1 hour": a span of seconds, in days when it is whole days. */
export function spanText(seconds: number): string {
  if (seconds > 0 && seconds % DAY === 0) {
    const days = seconds / DAY;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const h = Math.round(seconds / 3600);
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

/** "Wed 4 Nov 2026, 18:00 GMT" in a time zone (the visitor's when none is given). */
export function zonedDateText(unix: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
    timeZone,
  })
    .format(new Date(unix * 1000))
    .replace(/^(\w+),? /, "$1 ")
    .replace(/ at /, ", ");
}
