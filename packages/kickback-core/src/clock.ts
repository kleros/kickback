/**
 * Characters that can disguise a text without showing: C0 and C1 controls (line breaks included),
 * zero-width characters, line and paragraph separators, text-direction marks and overrides, the BOM.
 */
// eslint-disable-next-line no-control-regex
export const DISGUISE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;

/** "2026-11-04T18:00:00+05:30" → its offset in minutes (330), or null without one. */
export const offsetOf = (iso: unknown): number | null => {
  const m = /(Z|([+-])(\d\d):(\d\d))$/.exec(String(iso ?? ""));
  return !m ? null : m[1] === "Z" ? 0 : (m[2] === "-" ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4]));
};

/** "+05:30" for 330 minutes. */
export const offsetText = (minutes: number): string =>
  `${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;

/** The UTC offsets timezones use today, as offsetText writes them: the only ones eventClock accepts. */
// prettier-ignore
export const TZ_OFFSETS = [
  "-12:00", "-11:00", "-10:00", "-09:30", "-09:00", "-08:00", "-07:00", "-06:00", "-05:00", "-04:00", "-03:30", "-03:00", "-02:30", "-02:00",
  "-01:00", "+00:00", "+01:00", "+02:00", "+03:00", "+03:30", "+04:00", "+04:30", "+05:00", "+05:30", "+05:45", "+06:00", "+06:30", "+07:00",
  "+08:00", "+08:45", "+09:00", "+09:30", "+10:00", "+10:30", "+11:00", "+12:00", "+12:45", "+13:00", "+13:45", "+14:00",
];

/**
 * Timezone abbreviations and the UTC offsets (minutes) each can stand for, the one most readers take
 * it for first ("IST" is India's +05:30 before Irish or Israel time).
 */
// prettier-ignore
export const ZONE_OFFSETS: Readonly<Record<string, readonly number[]>> = {
  UTC: [0], GMT: [0], UT: [0], WET: [0], WEST: [60], BST: [60, 360], IST: [330, 60, 120], CET: [60], CEST: [120], MET: [60], MEST: [120],
  WAT: [60], CAT: [120], SAST: [120], EET: [120], EEST: [180], EAT: [180], MSK: [180], TRT: [180], AST: [-240, 180], ADT: [-180], GST: [240],
  PKT: [300], NPT: [345], BDT: [360], ICT: [420], WIB: [420], HKT: [480], SGT: [480], AWST: [480], PHT: [480], PHST: [480], JST: [540], KST: [540],
  ACST: [570], ACDT: [630], AEST: [600], AEDT: [660], NZST: [720], NZDT: [780], NST: [-210], NDT: [-150], BRT: [-180], ART: [-180],
  EST: [-300], EDT: [-240], CST: [-360, 480, -300], CDT: [-300], MST: [-420], MDT: [-360], PST: [-480, 480], PDT: [-420],
  AKST: [-540], AKDT: [-480], HST: [-600],
};

const UTC_NAME_RE = /\b(?:UTC|GMT)\s*([+\-\u2212])\s*(\d{1,2})(?::?(\d\d))?(?!\d)/g;
const utcNameOffset = (m: RegExpExecArray | RegExpMatchArray) =>
  (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
const hasZone = (z: string) => Object.prototype.hasOwnProperty.call(ZONE_OFFSETS, z);

/**
 * Checks a typed timezone name against the event's UTC offset (minutes): one line, at most 40
 * characters, and every abbreviation in it that ZONE_OFFSETS knows must be that offset. Returns it trimmed.
 */
export function checkZoneName(zone: unknown, offset: number): string {
  const z = String(zone ?? "")
    .normalize("NFC")
    .trim();
  if (DISGUISE_RE.test(z))
    throw new Error("Timezone name: please keep it on one line, without invisible or text-direction characters.");
  if (z.length > 40) throw new Error(`Timezone name is too long (${z.length} characters, at most 40).`);
  if (/\{\{|\}\}/.test(z)) throw new Error('Timezone name can\'t contain "{{" or "}}".');
  const wrong = (name: string) =>
    new Error(
      `Timezone name: "${name}" is not UTC${offsetText(offset)}, the timezone of the event on that date. Pick the right timezone, or correct or clear the name.`,
    );
  for (const m of z.matchAll(UTC_NAME_RE)) if (utcNameOffset(m) !== offset) throw wrong(m[0]);
  for (const m of z.replace(UTC_NAME_RE, " ").matchAll(/\b[A-Z]{2,5}\b/g))
    if (hasZone(m[0]) && !ZONE_OFFSETS[m[0]]!.includes(offset)) throw wrong(m[0]);
  return z;
}

/**
 * True when a timezone name is verifiably and unmistakably the offset (minutes): a whole "UTC+05:30" /
 * "GMT+7" form of it, or one abbreviation whose first meaning is that offset.
 */
export function zoneIs(name: unknown, offset: number): boolean {
  const z = String(name ?? "").trim();
  const m = /^(?:UTC|GMT) *([+\-\u2212]) *(\d{1,2})(?::?(\d\d))?$/.exec(z);
  if (m) return Number(m[3] ?? 0) < 60 && utcNameOffset(m) === offset;
  return hasZone(z) && ZONE_OFFSETS[z]![0] === offset;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "Wednesday 4 November 2026, 18:00-22:00 IST": the event's date and time in its own timezone (the
 * offset written in `startIso`). `zone` is the name to print, checked by checkZoneName; without it the offset is printed.
 */
export function describeWhen(startIso: string, endIso: string, zone = ""): string {
  const off = offsetOf(startIso);
  const t0 = Date.parse(startIso);
  const t1 = Date.parse(endIso);
  if (off === null || Number.isNaN(t0) || Number.isNaN(t1))
    throw new Error("Start and end must be dates with a timezone, e.g. 2026-11-04T18:00:00+05:30");
  if (t1 <= t0) throw new Error("The event must end after it starts.");
  const name = checkZoneName(zone, off);
  const local = (t: number) => new Date(t + off * 60_000); // read with getUTC*: the wall clock at the event
  const day = (d: Date) =>
    `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const time = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const a = local(t0);
  const b = local(t1);
  const tz = name || `UTC${offsetText(off)}`;
  return day(a) === day(b)
    ? `${day(a)}, ${time(a)}-${time(b)} ${tz}`
    : `${day(a)}, ${time(a)} to ${day(b)}, ${time(b)} ${tz}`;
}
