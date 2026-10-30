import { ipfsCidV0 } from "./caseText";
import { KLEROS_IPFS_GATEWAY } from "./constants";

export const MAX_EVENT_INFO_BYTES = 64 * 1024;
export const MAX_COVER_BYTES = 2 * 1024 * 1024;
export const COVER_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export interface EventCover {
  path: string;
  mime: (typeof COVER_MIMES)[number];
  bytes: number;
}
export interface EventInfoLink {
  label: string;
  url: string;
}
export interface EventInfoDocument {
  version: 1;
  description: string;
  cover?: EventCover;
  links: EventInfoLink[];
}
export const isEventInfoPath = (path: unknown): path is string =>
  typeof path === "string" && /^\/ipfs\/Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(path);

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !keys.includes(k)))
    throw new Error("Invalid event info fields.");
  return value as Record<string, unknown>;
}
function plain(value: unknown, max: number, multiline = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    value !== value.normalize("NFC") ||
    /[\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}<>]|\{\{|\}\}/u.test(value) ||
    /\p{Cc}|\p{Zl}|\p{Zp}/u.test(multiline ? value.replace(/\n/g, "") : value)
  )
    throw new Error("Use plain NFC text without invisible characters or template placeholders.");
  return value;
}
export function eventInfoLinkUrl(value: unknown): string {
  const raw = plain(value, 2048);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname ||
    !/^https:\/\/[\x21-\x7e]+(?:[/?#]|$)/i.test(raw) ||
    /\s|\\/.test(raw)
  )
    throw new Error("Links must use HTTPS and a printable host without credentials.");
  return raw;
}
export function validateEventInfo(input: unknown): EventInfoDocument {
  const doc = record(input, ["version", "description", "cover", "links"]);
  if (doc.version !== 1) throw new Error("Unsupported event info version.");
  const description = plain(doc.description, 1200, true);
  if (!Array.isArray(doc.links) || doc.links.length > 3) throw new Error("Use at most 3 links.");
  const links = doc.links.map((item) => {
    const link = record(item, ["label", "url"]);
    const label = plain(link.label, 40);
    if (!label.trim()) throw new Error("Give each link a label.");
    return { label, url: eventInfoLinkUrl(link.url) };
  });
  let cover: EventCover | undefined;
  if (doc.cover !== undefined) {
    const c = record(doc.cover, ["path", "mime", "bytes"]);
    if (
      !isEventInfoPath(c.path) ||
      !COVER_MIMES.includes(c.mime as EventCover["mime"]) ||
      typeof c.bytes !== "number" ||
      !Number.isInteger(c.bytes) ||
      c.bytes < 1 ||
      c.bytes > MAX_COVER_BYTES
    )
      throw new Error("Invalid cover path, image type or size (maximum 2 MB).");
    cover = { path: c.path, mime: c.mime as EventCover["mime"], bytes: c.bytes };
  }
  return { version: 1, description, ...(cover ? { cover } : {}), links };
}
export function buildEventInfo(input: {
  description?: string;
  cover?: EventCover;
  links?: EventInfoLink[];
}): EventInfoDocument {
  return validateEventInfo({
    version: 1,
    description: (input.description ?? "").normalize("NFC").trim(),
    ...(input.cover ? { cover: input.cover } : {}),
    links: (input.links ?? []).map((l) => ({ label: l.label.normalize("NFC").trim(), url: l.url.trim() })),
  });
}
export function serializeEventInfo(input: EventInfoDocument): string {
  const d = validateEventInfo(input);
  return JSON.stringify({
    ...(d.cover ? { cover: { bytes: d.cover.bytes, mime: d.cover.mime, path: d.cover.path } } : {}),
    description: d.description,
    links: d.links.map((l) => ({ label: l.label, url: l.url })),
    version: d.version,
  });
}
export function parseEventInfo(text: string): EventInfoDocument {
  if (new TextEncoder().encode(text).length > MAX_EVENT_INFO_BYTES) throw new Error("Event info exceeds 64 KB.");
  return validateEventInfo(JSON.parse(text));
}
export async function readLimitedBytes(response: Response, max: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new Error("Response exceeds the size limit.");
  }
  if (!response.body) throw new Error("Missing response body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("Response exceeds the size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function fetchVerifiedIpfs(
  path: string,
  max: number,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Uint8Array> {
  if (!isEventInfoPath(path)) throw new Error("Invalid CIDv0 path.");
  const response = await fetcher(`${KLEROS_IPFS_GATEWAY}${path}`, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Could not fetch the pinned file.");
  const bytes = await readLimitedBytes(response, max);
  if (`/ipfs/${ipfsCidV0(bytes)}` !== path) throw new Error("The pinned file CID does not match.");
  return bytes;
}
export async function fetchEventInfo(path: string, fetcher?: typeof fetch): Promise<EventInfoDocument> {
  return parseEventInfo(
    new TextDecoder("utf-8", { fatal: true }).decode(await fetchVerifiedIpfs(path, MAX_EVENT_INFO_BYTES, fetcher)),
  );
}
export function imageMime(bytes: Uint8Array): EventCover["mime"] | "image/gif" | null {
  const starts = (signature: number[]) => signature.every((v, i) => bytes[i] === v);
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (starts([255, 216, 255])) return "image/jpeg";
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  return null;
}
export async function fetchEventCover(cover: EventCover, fetcher?: typeof fetch): Promise<Blob> {
  validateEventInfo({ version: 1, description: "", links: [], cover });
  const bytes = await fetchVerifiedIpfs(cover.path, cover.bytes, fetcher);
  if (bytes.length !== cover.bytes || imageMime(bytes) !== cover.mime)
    throw new Error("The cover size or image type does not match.");
  return new Blob([new Uint8Array(bytes)], { type: cover.mime });
}
// The caller must revoke the object URL when it is no longer displayed.
export async function eventCoverObjectUrl(cover: EventCover, fetcher?: typeof fetch): Promise<string> {
  return URL.createObjectURL(await fetchEventCover(cover, fetcher));
}
