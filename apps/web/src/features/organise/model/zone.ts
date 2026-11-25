/** The browser's time zone ("Europe/Paris"), or UTC when it cannot tell. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Every zone this browser knows, with the given one kept in the list. */
export function zoneList(keep: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (!zones.includes("UTC")) zones = ["UTC", ...zones];
  return zones.includes(keep) ? zones : [keep, ...zones];
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(zone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** Unix seconds of a wall-clock "2026-11-24T18:00" in `zone` (the event's place, not the browser's). */
export function zonedUnix(value: string, zone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return NaN;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  // the offset at the guess, then again at the corrected instant (daylight-saving edges)
  let ms = asUtc - offsetMinutes(zone, asUtc) * 60_000;
  ms = asUtc - offsetMinutes(zone, ms) * 60_000;
  return Math.floor(ms / 1000);
}

/** "GMT+1" for a zone at that instant, to show next to the times. */
export function zoneLabel(zone: string, unix: number): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(unix * 1000))
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? zone;
  } catch {
    return zone;
  }
}
