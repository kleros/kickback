import { visibleLink } from "@/lib/event-details";

export { fillShare, DEFAULT_SHARE_TEMPLATE } from "@kickback/core";

export function shareUrls(text: string, luma: string, guestLink: string) {
  const e = encodeURIComponent;
  const url = luma || guestLink;
  return {
    X: `https://x.com/intent/post?text=${e(text.includes(url) ? text : `${text} ${url}`)}`,
    LinkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`,
    // Telegram prints `url` and then `text`: a text that carries the link goes alone, so the link shows once
    Telegram: text.includes(url)
      ? `https://t.me/share/url?url=${e(text)}`
      : `https://t.me/share/url?url=${e(url)}&text=${e(text)}`,
  };
}

export function supportsPhoneShare(share: unknown, phone: boolean) {
  return phone && typeof share === "function";
}

export function lumaShareLink(value: string | null | undefined): string {
  const link = visibleLink(value);
  return link && /^(?:www\.)?(?:lu\.ma|luma\.com)$/.test(link.domain) ? link.href : "";
}
