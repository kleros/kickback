import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import { imageMime, readLimitedBytes } from "@kickback/core";

export const PREVIEW_HOSTS = [
  { host: "luma.com", subdomains: false },
  { host: "lu.ma", subdomains: false },
  { host: "partiful.com", subdomains: false },
  { host: "eventbrite.com", subdomains: true },
  { host: "meetup.com", subdomains: false },
] as const;
export function previewUrl(raw: string): URL {
  if (raw.length > 2048 || !/^https:\/\/[a-z0-9.-]+(?:[/?#]|$)/i.test(raw) || /\s|\\/.test(raw))
    throw new Error("Invalid preview URL.");
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname.split(".").some((label) => label.startsWith("xn--")) ||
    !PREVIEW_HOSTS.some(
      (rule) => url.hostname === rule.host || (rule.subdomains && url.hostname.endsWith(`.${rule.host}`)),
    )
  )
    throw new Error("Preview host is not allowed.");
  url.hash = "";
  return url;
}
function resolvePreviewUrl(reference: string, base: URL): URL {
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) return previewUrl(reference);
  if (reference.startsWith("//")) return previewUrl(`https:${reference}`);
  if (/\s|\\/.test(reference)) throw new Error("Invalid preview URL.");
  return previewUrl(new URL(reference, base).href);
}
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family !== 6 || address.includes("%") || address.includes(".")) return false;
  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 1 ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  const first = parseInt(groups[0]!, 16),
    second = parseInt(groups[1]!, 16);
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    !(first === 0x3fff && second < 0x1000)
  );
}
export interface PreviewAddress {
  address: string;
  family: number;
}
export interface PreviewTransport {
  resolve(host: string): Promise<PreviewAddress[]>;
  fetch(url: URL, address: PreviewAddress, signal: AbortSignal): Promise<Response>;
}
export const previewTransport: PreviewTransport = {
  resolve: (host) => lookup(host, { all: true, verbatim: true }),
  fetch: (url, address, signal) =>
    new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          signal,
          agent: false,
          rejectUnauthorized: true,
          family: address.family,
          maxHeaderSize: 16 * 1024,
          headers: { Accept: "text/html,image/png,image/jpeg,image/webp,image/gif", "Accept-Encoding": "identity" },
          // TLS SNI and certificate verification retain the URL host; DNS cannot change the checked destination.
          lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        },
        (res) => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers))
            if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          const status = res.statusCode ?? 502;
          if ([204, 205, 304].includes(status)) {
            res.resume();
            resolve(new Response(null, { status, headers }));
          } else resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers }));
        },
      );
      req.on("error", reject);
      req.end();
    }),
};
export async function fetchPreviewResource(
  raw: string,
  max: number,
  mimeTypes: readonly string[],
  transport = previewTransport,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Preview timed out."));
    }, 3000);
  });
  const run = async () => {
    let url = previewUrl(raw);
    for (let redirects = 0; ; redirects++) {
      const addresses = await transport.resolve(url.hostname);
      controller.signal.throwIfAborted();
      if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address) || isIP(a.address) !== a.family))
        throw new Error("Preview resolved to a forbidden address.");
      const response = await transport.fetch(url, addresses[0]!, controller.signal);
      controller.signal.throwIfAborted();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (redirects >= 2) throw new Error("Too many preview redirects.");
        const location = response.headers.get("location");
        if (!location) throw new Error("Missing redirect URL.");
        url = resolvePreviewUrl(location, url);
        continue;
      }
      const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (
        !response.ok ||
        !mimeTypes.includes(mime) ||
        ![null, "identity"].includes(response.headers.get("content-encoding"))
      ) {
        await response.body?.cancel();
        throw new Error("Unsupported preview response.");
      }
      const bytes = await readLimitedBytes(response, max);
      return { url, bytes, mime };
    }
  };
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, key: string) => {
    if (key[0] !== "#") return entities[key.toLowerCase()] ?? match;
    const n = key[1]?.toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  });
}
const cleanText = (text: string, max: number) =>
  decodeEntities(text)
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
export function parsePreviewHtml(html: string) {
  const values: Record<string, string> = {};
  const lower = html.toLowerCase();
  const allowed = ["og:title", "og:description", "og:site_name", "og:image", "twitter:image"];
  let title = "";
  let position = 0;
  while (position < html.length) {
    const start = html.indexOf("<", position);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      if (end < 0) break;
      position = end + 3;
      continue;
    }
    let end = start + 1;
    let quote = "";
    for (; end < html.length; end++) {
      const char = html[end]!;
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">" || char === "<") break;
    }
    if (end === html.length) break;
    if (html[end] === "<") {
      position = end;
      continue;
    }
    position = end + 1;
    const tag = html.slice(start, end + 1);
    const name = /^<([a-z]+)(?=[\s/>])/i.exec(tag)?.[1]?.toLowerCase();
    if (!name) continue;
    if (["script", "style", "textarea", "noscript", "title"].includes(name)) {
      // Skip raw-text contents in one pass, including malformed or unclosed elements.
      const close = lower.indexOf(`</${name}`, position);
      if (close < 0) break;
      if (name === "title" && !title) title = html.slice(position, close);
      const closeEnd = html.indexOf(">", close);
      if (closeEnd < 0) break;
      position = closeEnd + 1;
      continue;
    }
    if (name !== "meta") continue;
    const attrs: Record<string, string> = {};
    const attrPattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gy;
    let offset = 5;
    while (offset < tag.length - 1) {
      while (/\s/.test(tag[offset] ?? "")) offset++;
      attrPattern.lastIndex = offset;
      const attr = attrPattern.exec(tag);
      if (attr) {
        attrs[attr[1]!.toLowerCase()] ??= attr[2] ?? attr[3] ?? attr[4] ?? "";
        offset = attrPattern.lastIndex;
      } else {
        while (offset < tag.length - 1 && !/\s/.test(tag[offset]!)) offset++;
      }
    }
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (allowed.includes(key) && attrs.content !== undefined) values[key] ??= attrs.content;
  }
  return {
    title: cleanText(values["og:title"] ?? title, 200),
    description: cleanText(values["og:description"] ?? "", 500),
    siteName: cleanText(values["og:site_name"] ?? "", 80),
    image: decodeEntities(values["og:image"] ?? values["twitter:image"] ?? "").trim(),
  };
}
export async function linkPreview(raw: string, transport = previewTransport) {
  const { bytes, url } = await fetchPreviewResource(raw, 512 * 1024, ["text/html", "application/xhtml+xml"], transport);
  const parsed = parsePreviewHtml(new TextDecoder().decode(bytes));
  let image: string | null = null;
  if (parsed.image) {
    try {
      image = `/api/preview/image?url=${encodeURIComponent(resolvePreviewUrl(parsed.image, url).href)}`;
    } catch {
      /* Images outside the preview allowlist are omitted. */
    }
  }
  return { ...parsed, image, host: url.hostname };
}
export async function previewImage(raw: string, transport = previewTransport) {
  const result = await fetchPreviewResource(
    raw,
    1024 * 1024,
    ["image/png", "image/jpeg", "image/webp", "image/gif"],
    transport,
  );
  if (imageMime(result.bytes) !== result.mime) throw new Error("Image bytes do not match their content type.");
  return result;
}
