import { visibleLink } from "@/lib/event-details";

export { fillShare, DEFAULT_SHARE_TEMPLATE } from "@kickback/core";

export function shareUrls(text: string, luma: string, guestLink: string) {
  const e = encodeURIComponent;
  const url = luma || guestLink;
  return {
    X: `https://x.com/intent/post?text=${e(text)}`,
    Farcaster: `https://farcaster.xyz/~/compose?text=${e(text)}${luma ? `&embeds[]=${e(luma)}` : ""}`,
    LinkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`,
    Telegram: `https://t.me/share/url?url=${e(url)}&text=${e(text)}`,
  };
}

export function supportsPhoneShare(share: unknown, phone: boolean) {
  return phone && typeof share === "function";
}

export function lumaShareLink(value: string | null | undefined): string {
  const link = visibleLink(value);
  return link && /^(?:www\.)?(?:lu\.ma|luma\.com)$/.test(link.domain) ? link.href : "";
}
