/** An https link safe to show and open: printable host, no credentials, no spaces or backslashes. */
export function eventInfoLinkUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    value !== value.normalize("NFC") ||
    /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>]/u.test(value)
  )
    throw new Error("Use a plain link without invisible characters.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname ||
    !/^https:\/\/[\x21-\x7e]+(?:[/?#]|$)/i.test(value) ||
    /\s|\\/.test(value)
  )
    throw new Error("Links must use HTTPS and a printable host without credentials.");
  return value;
}

// Load only on user action; iframe sandbox="allow-scripts allow-same-origin allow-popups", referrerpolicy="no-referrer".
export function mapEmbedUrl(where: string): string {
  const value = where.trim();
  if (!value || value.length > 200 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value))
    throw new Error("Use a venue of 1 to 200 characters.");
  return `https://www.google.com/maps?q=${encodeURIComponent(value)}&output=embed`;
}

/** The body of `response`, refused once it passes `max` bytes. */
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

/** The image type from the file's first bytes. */
export function imageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  const starts = (signature: number[]) => signature.every((v, i) => bytes[i] === v);
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (starts([255, 216, 255])) return "image/jpeg";
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  return null;
}
