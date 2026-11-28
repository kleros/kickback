/** A named zone ("Europe/Paris", "America/Argentina/Buenos_Aires", "UTC"): kept as the browser gives it. */
const NAMED_ZONE = /^[A-Za-z]+\/[A-Za-z_\-+0-9/]+$/;

/**
 * The browser's time zone ("Europe/Paris"), or UTC when it cannot tell. An offset id ("+00:00", "-05:30") or an
 * unknown one becomes a readable zone with the same offset: "UTC" or "Etc/GMT-9" for +09:00 (the sign is inverted
 * in these ids); a half-hour offset keeps its id, which Intl still accepts.
 */
export function browserZone(): string {
  let zone: string;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
  return normalZone(zone);
}

/** Old zone names some browsers (Chrome, Node) still list, with today's IANA name. */
const LEGACY: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Mendoza": "America/Argentina/Mendoza",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** Today's name for a renamed zone ("Asia/Calcutta" is "Asia/Kolkata"), when this browser knows the new name. */
export function currentZoneName(zone: string): string {
  const next = LEGACY[zone];
  if (!next) return zone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: next });
    return next;
  } catch {
    return zone;
  }
}

export function normalZone(zone: string, now = Date.now()): string {
  zone = currentZoneName(zone);
  if (zone === "UTC" || (NAMED_ZONE.test(zone) && !/^Etc\/Unknown$/i.test(zone))) return zone;
  let offset: number;
  try {
    offset = offsetMinutes(zone, now);
  } catch {
    return "UTC";
  }
  if (offset === 0) return "UTC";
  if (offset % 60 === 0) return `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset / 60)}`;
  return zone;
}

/** Every zone this browser knows, with the given one kept in the list. */
export function zoneList(keep: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  // one entry per zone, under its current name (Chrome lists "Asia/Calcutta", Firefox "Asia/Kolkata")
  zones = [...new Set(zones.map(currentZoneName))].sort();
  keep = currentZoneName(keep);
  if (!zones.includes("UTC")) zones = ["UTC", ...zones];
  return zones.includes(keep) ? zones : [keep, ...zones];
}

const zoneKey = (chainId: number, where: string) => `kb-zone:${chainId}:${where.toLowerCase()}`;

/**
 * The time zone the organiser picked when creating an event, kept in this browser only (the contract has no zone):
 * saved under the factory and wallet before the create is sent, then under the new event's contract.
 */
export const eventZone = {
  saveCreate(chainId: number, account: string, zone: string) {
    try {
      localStorage.setItem(zoneKey(chainId, `create:${account}`), zone);
    } catch {
      /* storage refused: the pages fall back to the device's zone */
    }
  },
  /** Moves the zone saved at create time to the event it created. */
  settle(chainId: number, account: string, contract: string) {
    try {
      const zone = localStorage.getItem(zoneKey(chainId, `create:${account}`));
      if (zone) localStorage.setItem(zoneKey(chainId, contract), zone);
    } catch {
      /* as above */
    }
  },
  read(chainId: number, contract: string): string | null {
    try {
      const zone = localStorage.getItem(zoneKey(chainId, contract));
      if (!zone) return null;
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return zone;
    } catch {
      return null;
    }
  },
};

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
