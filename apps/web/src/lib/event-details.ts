import { eventInfoLinkUrl, mapEmbedUrl } from "@kickback/core";

export function visibleLink(raw: string | null | undefined) {
  try {
    const href = eventInfoLinkUrl(raw);
    return { href, domain: new URL(href).hostname };
  } catch {
    return null;
  }
}

export function venueMap(where: string | null) {
  try {
    return where ? mapEmbedUrl(where) : null;
  } catch {
    return null;
  }
}

export interface RegistrationPreview {
  title: string;
  siteName: string;
  image: string | null;
}
