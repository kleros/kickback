import { describe, expect, it } from "vitest";

import { lumaShareLink, shareUrls, supportsPhoneShare } from "../socialShare";

const luma = "https://luma.com/🎉?a=1&b=2";
const guest = "https://kickback.test/event/0x123?from=42&x=1";

describe.each(["Going 🎉 & bringing friends", "x".repeat(280)])("share URLs for %s", (text) => {
  const urls = shareUrls(text, luma, guest);
  it("encodes X text", () => expect(urls.X).toBe(`https://x.com/intent/post?text=${encodeURIComponent(text)}`));
  it("encodes Farcaster text and embed", () =>
    expect(urls.Farcaster).toBe(
      `https://farcaster.xyz/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(luma)}`,
    ));
  it("encodes LinkedIn's Luma URL", () =>
    expect(urls.LinkedIn).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(luma)}`));
  it("encodes Telegram URL and text independently", () =>
    expect(urls.Telegram).toBe(
      `https://t.me/share/url?url=${encodeURIComponent(luma)}&text=${encodeURIComponent(text)}`,
    ));
});
it("falls back to guest URL and omits an empty Farcaster embed", () => {
  const urls = shareUrls("Hello", "", guest);
  expect(new URL(urls.LinkedIn).searchParams.get("url")).toBe(guest);
  expect(new URL(urls.Telegram).searchParams.get("url")).toBe(guest);
  expect(urls.Farcaster).not.toContain("embeds");
});
it("uses native sharing only on capable phones", () => {
  expect(supportsPhoneShare(() => {}, true)).toBe(true);
  expect(supportsPhoneShare(() => {}, false)).toBe(false);
  expect(supportsPhoneShare(undefined, true)).toBe(false);
});

it("keeps Luma query parameters and rejects look-alike or unsafe registration hosts", () => {
  expect(lumaShareLink("https://luma.com/dinner?ref=host&a=1&b=2")).toBe("https://luma.com/dinner?ref=host&a=1&b=2");
  expect(lumaShareLink("https://www.lu.ma/dinner")).toBe("https://www.lu.ma/dinner");
  for (const url of [
    "https://luma.com.evil.test/dinner",
    "https://luma.com@evil.test/dinner",
    "http://luma.com/dinner",
    undefined,
  ]) {
    expect(lumaShareLink(url)).toBe("");
  }
});
