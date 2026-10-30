export const DEFAULT_SHARE_TEMPLATE = "I just locked my spot at {event} with a refundable deposit. Join: {luma}";
export const SHARE_LIMIT = 280;
export interface ShareDetails {
  event: string;
  date: string;
  venue: string;
  luma: string;
  guestLink: string;
}
const PLACEHOLDER = /\{(event|date|venue|luma|guestLink)\}/g;

export function validateShare(value: unknown): string {
  if (
    typeof value !== "string" ||
    Array.from(value).length > SHARE_LIMIT ||
    value !== value.normalize("NFC") ||
    /[\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Zl}\p{Zp}<>]/u.test(value) ||
    /[{}]/.test(value.replace(PLACEHOLDER, ""))
  )
    throw new Error("Use plain text up to 280 characters and only {event}, {date}, {venue}, {luma}, {guestLink}.");
  return value;
}

export function fillShare(template: string | undefined, details: ShareDetails): string {
  const source = template?.trim() || DEFAULT_SHARE_TEMPLATE;
  const filled = source.replace(PLACEHOLDER, (_, key: keyof ShareDetails) =>
    key === "luma" ? details.luma || details.guestLink : details[key],
  );
  if (Array.from(filled).length <= SHARE_LIMIT) return filled;
  const parts = filled.split(/(https?:\/\/[^\s]+)/g);
  const urls = parts.filter((_, i) => i % 2 === 1);
  // URLs are atomic; an address longer than the entire post is omitted, never sliced.
  let urlBudget = SHARE_LIMIT - 1;
  const kept = urls.map((url) => {
    const length = Array.from(url).length + 1;
    if (length > urlBudget) return "";
    urlBudget -= length;
    return url;
  });
  const prose = parts
    .filter((_, i) => i % 2 === 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const cut = Array.from(prose).slice(0, urlBudget).join("");
  const prefix =
    /\s/.test(cut) && /\S/.test(Array.from(prose)[urlBudget] ?? "")
      ? cut.replace(/\s+\S*$/, "").trimEnd()
      : cut.trimEnd();
  return [prefix + "…", ...kept.filter(Boolean)].join(" ");
}
