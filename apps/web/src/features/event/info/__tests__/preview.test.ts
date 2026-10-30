// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";

import {
  isPublicAddress,
  previewUrl,
  parsePreviewHtml,
  fetchPreviewResource,
  linkPreview,
  previewImage,
  previewTransport,
  type PreviewTransport,
} from "../preview";

const publicIP = { address: "93.184.216.34", family: 4 };
const transport = (html = "<title>Dinner</title>"): PreviewTransport => ({
  resolve: vi.fn(async () => [publicIP]),
  fetch: vi.fn(async () => new Response(html, { headers: { "content-type": "text/html" } })),
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("preview URLs", () => {
  it.each([
    "https://luma.com/e",
    "https://lu.ma/e",
    "https://partiful.com/e",
    "https://meetup.com/e",
    "https://eventbrite.com",
    "https://www.eventbrite.com/e",
    "https://a.b.eventbrite.com/e",
  ])("allows %s", (raw) => {
    expect(previewUrl(raw).protocol).toBe("https:");
  });
  it.each([
    "http://luma.com",
    "ftp://luma.com",
    "https://luma.com:443",
    "https://luma.com:8443",
    "https://a@luma.com",
    "https://a:b@luma.com",
    "https://@luma.com",
    "https://luma.com@evil.com",
    "https://luma.com.evil.com",
    "https://evileventbrite.com",
    "https://www.luma.com",
    "https://eventbrite.com.",
    "https://luma.com\\@evil.com",
    "https://luma.com\n.evil.com",
    " https://luma.com",
    "https://%6cuma.com",
    "https://lumа.com",
    "https://xn--lum-8cd.com",
    "https://xn--test.eventbrite.com",
    "https://127.0.0.1",
    "https://2130706433",
    "https://0177.0.0.1",
    "https://0x7f000001",
    "https://127.1",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:7f00:1]",
    "//luma.com",
    "https://luma.com/" + "x".repeat(2048),
  ])("rejects %s", (raw) => expect(() => previewUrl(raw)).toThrow());
});

describe("IP ranges", () => {
  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "169.253.255.255",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("allows public %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.0",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.0.0",
    "169.254.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.168.0.0",
    "192.168.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.0",
    "198.19.255.255",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "2130706433",
    "0177.0.0.1",
    "0x7f000001",
    "127.1",
    "0127.0.0.1",
    "garbage",
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:8.8.8.8",
    "::127.0.0.1",
    "fc00::1",
    "fdff:ffff::1",
    "fe80::1",
    "fe80::1%eth0",
    "fec0::1",
    "ff02::1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "2001::1",
    "2001:db8::1",
    "3fff::1",
    "[::1]",
  ])("refuses nonpublic or noncanonical %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
});

describe("checked fetch", () => {
  it("checks every DNS answer before fetching and pins the selected address", async () => {
    const t = transport();
    await linkPreview("https://luma.com/event", t);
    expect(t.fetch).toHaveBeenCalledWith(new URL("https://luma.com/event"), publicIP, expect.any(AbortSignal));
    for (const addresses of [
      [],
      [publicIP, { address: "10.0.0.1", family: 4 }],
      [{ address: "93.184.216.34", family: 6 }],
    ]) {
      const blocked = transport();
      blocked.resolve = vi.fn(async () => addresses);
      await expect(linkPreview("https://luma.com/event", blocked)).rejects.toThrow("address");
      expect(blocked.fetch).not.toHaveBeenCalled();
    }
  });
  it("rechecks redirects and permits at most two", async () => {
    const t = transport();
    t.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://eventbrite.com/a" } }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/b" } }))
      .mockResolvedValueOnce(new Response("<title>Final</title>", { headers: { "content-type": "text/html" } }));
    expect(await linkPreview("https://luma.com/e", t)).toMatchObject({ title: "Final", host: "eventbrite.com" });
    expect(t.resolve).toHaveBeenCalledTimes(3);
    t.fetch = vi.fn(async () => new Response(null, { status: 301, headers: { location: "/loop" } }));
    await expect(linkPreview("https://luma.com", t)).rejects.toThrow("redirects");
    expect(t.fetch).toHaveBeenCalledTimes(3);
  });
  it.each([
    "https://evil.com",
    "http://luma.com",
    "https://luma.com:8080",
    "https://luma.com:443",
    "https://@luma.com",
    "https://user@luma.com",
    "https://127.1",
  ])("refuses redirect to %s", (location) => {
    const t = transport();
    t.fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    return expect(linkPreview("https://luma.com", t)).rejects.toThrow();
  });
  it("refuses a rebinding answer on a second request to the same host", async () => {
    const t = transport();
    t.resolve = vi
      .fn()
      .mockResolvedValueOnce([publicIP])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    t.fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "/again" } }));
    await expect(linkPreview("https://luma.com", t)).rejects.toThrow("address");
    expect(t.fetch).toHaveBeenCalledOnce();
  });
  it.each(["dns", "fetch", "body"])("enforces one 3-second deadline including %s", async (stage) => {
    vi.useFakeTimers();
    const t = transport();
    if (stage === "dns") t.resolve = () => new Promise(() => {});
    if (stage === "fetch") t.fetch = () => new Promise(() => {});
    if (stage === "body")
      t.fetch = async () => new Response(new ReadableStream(), { headers: { "content-type": "text/html" } });
    const result = expect(linkPreview("https://luma.com", t)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(3000);
    await result;
  });
  it("rejects incorrect types, compressed bodies, status errors and oversized bytes", async () => {
    for (const response of [
      new Response("{}", { headers: { "content-type": "application/json" } }),
      new Response("x", { headers: { "content-type": "text/html", "content-encoding": "gzip" } }),
      new Response("x", { status: 500, headers: { "content-type": "text/html" } }),
      new Response("x".repeat(512 * 1024 + 1), { headers: { "content-type": "text/html" } }),
    ]) {
      const t = transport();
      t.fetch = async () => response;
      await expect(linkPreview("https://luma.com", t)).rejects.toThrow();
    }
  });
  it("does not resolve a disallowed URL", async () => {
    const t = transport();
    await expect(fetchPreviewResource("https://evil.com", 1, [], t)).rejects.toThrow();
    expect(t.resolve).not.toHaveBeenCalled();
  });
});

describe("metadata and images", () => {
  it("reads only allowed metadata without executing scripts or parsing a DOM", () => {
    expect(
      parsePreviewHtml(`<!-- <meta property="og:title" content="Comment"> --><script><meta property="og:title" content="Script"></script>
      <title>Fallback</title><META content=' Dinner &amp; talks ' property='og:title'><meta name="og:description" content="&lt;b&gt;Text&lt;/b&gt;&#x202e;">
      <meta property=og:site_name content='Host'><meta name='twitter:image' content='/image.png'><meta name=description content='Ignored'>`),
    ).toEqual({
      title: "Dinner & talks",
      description: "<b>Text</b>",
      siteName: "Host",
      image: "/image.png",
    });
    expect(parsePreviewHtml("<title> A &#38; B </title>").title).toBe("A & B");
    expect(parsePreviewHtml(`<meta property=og:title content='${"x".repeat(300)}'>`).title).toHaveLength(200);
    expect(parsePreviewHtml("<script><title>Not metadata</title>").title).toBe("");
  });
  it("does not rescan malformed tags or read metadata inside raw-text elements", () => {
    expect(parsePreviewHtml("<meta ".repeat(50_000))).toEqual({ title: "", description: "", siteName: "", image: "" });
    expect(
      parsePreviewHtml(
        `<textarea><meta property="og:title" content="Hidden"></textarea><meta disabled property="og:title" content="Visible">`,
      ).title,
    ).toBe("Visible");
  });
  it("only emits same-origin proxy paths for allowed image URLs", async () => {
    expect(
      (await linkPreview("https://luma.com/e", transport('<meta property="og:image" content="/a.png">'))).image,
    ).toBe("/api/preview/image?url=https%3A%2F%2Fluma.com%2Fa.png");
    for (const image of ["https://evil.com/a.png", "data:image/png;base64,aaa", "javascript:evil()"])
      expect(
        (await linkPreview("https://luma.com/e", transport(`<meta property="og:image" content="${image}">`))).image,
      ).toBeNull();
  });
  it.each([
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/jpeg", [255, 216, 255]],
    ["image/webp", [...Buffer.from("RIFF0000WEBP")]],
    ["image/gif", [...Buffer.from("GIF89a")]],
  ] as const)("accepts verified %s bytes", async (mime, bytes) => {
    const t = transport();
    t.fetch = async () => new Response(new Uint8Array(bytes), { headers: { "content-type": mime } });
    expect((await previewImage("https://luma.com/image", t)).mime).toBe(mime);
  });
  it("refuses SVG, MIME spoofing and oversized images", async () => {
    for (const [mime, body] of [
      ["image/svg+xml", "<svg/>"],
      ["image/png", "<script/>"],
      ["image/png", "a".repeat(1024 * 1024 + 1)],
    ]) {
      const t = transport();
      t.fetch = async () => new Response(body, { headers: { "content-type": mime! } });
      await expect(previewImage("https://luma.com/image", t)).rejects.toThrow();
    }
  });
  it("provides a concrete production transport", () => {
    expect(previewTransport.resolve).toBeTypeOf("function");
    expect(previewTransport.fetch).toBeTypeOf("function");
  });
});
