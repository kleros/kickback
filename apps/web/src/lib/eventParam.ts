/**
 * An event address from a link's path segment, cleaned of what copying a link out of a chat or a Luma description
 * often adds around it: spaces, a full stop, brackets, quotes. Only exactly 40 hex characters after 0x (or 0X, which some keyboards type) are kept, so a
 * truncated or longer address is still refused as it is. A malformed escape (%E0) is kept as typed, never a crash.
 */
export function cleanEventParam(raw: string): string {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    // keep the raw text: the page refuses it as not an address
  }
  s = s.trim();
  const m = /^[^0-9a-zA-Z]*(0[xX][0-9a-fA-F]{40})[^0-9a-zA-Z]*$/.exec(s);
  return m ? `0x${m[1]!.slice(2)}` : s;
}

/** The decoded path segment, as the page received it (a malformed escape kept as typed). */
export function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
