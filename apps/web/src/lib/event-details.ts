import { eventInfoLinkUrl, mapEmbedUrl } from "@kickback/core";

export function visibleLink(raw: string | null | undefined) {
  try {
    const href = eventInfoLinkUrl(raw);
    return { href, domain: new URL(href).hostname };
  } catch {
    return null;
  }
}

/** The place to search on the map: the "(planned: …)" part when the venue text is a sentence around it. */
export function mapQuery(where: string): string {
  return /\(planned:\s*(.+)\)\s*$/i.exec(where)?.[1]?.trim() || where;
}

export function venueMap(where: string | null) {
  try {
    return where ? mapEmbedUrl(mapQuery(where)) : null;
  } catch {
    return null;
  }
}

export interface RegistrationPreview {
  title: string;
  siteName: string;
  image: string | null;
}
