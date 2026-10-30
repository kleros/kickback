import jsQR from "jsqr";
import QRCodeStyling from "qr-code-styling";
import { describe, expect, it } from "vitest";

import { txHref } from "../depositState";
import { qrOptions, QR_PALETTES } from "../qr";

const hash = `0x${"1234567890abcdef".repeat(4)}` as const;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) =>
  rgb(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i]!, 0);

it("chooses the chain explorer or the raw local hash", () => {
  expect(txHref("https://etherscan.io", hash)).toBe(`https://etherscan.io/tx/${hash}`);
  expect(txHref("https://sepolia.etherscan.io", hash)).toBe(`https://sepolia.etherscan.io/tx/${hash}`);
  expect(txHref(undefined, hash) ?? hash).toBe(hash);
});

describe.each([false, true])("QR dark=%s", (dark) => {
  it("decodes the library matrix in its gradient palette with a central logo-sized occlusion", () => {
    const url = txHref("https://sepolia.etherscan.io", hash)!;
    const options = qrOptions(url, dark);
    const qr = new QRCodeStyling(options);
    // jsdom has no canvas renderer; the library exposes the same encoded matrix used by its SVG renderer.
    const matrix = qr._qr!;
    const count = matrix.getModuleCount();
    const scale = 8,
      quiet = 5,
      size = (count + quiet * 2) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4);
    const palette = dark ? QR_PALETTES.dark : QR_PALETTES.light;
    const start = rgb(palette.start),
      end = rgb(palette.end),
      background = rgb(palette.background);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const row = Math.floor(y / scale) - quiet,
          col = Math.floor(x / scale) - quiet;
        const centre = Math.abs(x - size / 2) < size * 0.11 && Math.abs(y - size / 2) < size * 0.11;
        const ink = row >= 0 && row < count && col >= 0 && col < count && matrix.isDark(row, col) && !centre;
        const mix = (x + y) / (2 * size);
        const colour = ink ? start.map((c, i) => Math.round(c + (end[i]! - c) * mix)) : background;
        pixels.set([...colour, 255], (y * size + x) * 4);
      }
    expect(jsQR(pixels, size, size)?.data).toBe(url);
    expect(options.qrOptions?.errorCorrectionLevel).toBe("H");
    expect(options.dotsOptions?.type).toBe("rounded");
    expect(options.cornersSquareOptions?.type).toBe("extra-rounded");
    for (const colour of [palette.start, palette.end])
      expect((luminance(palette.background) + 0.05) / (luminance(colour) + 0.05)).toBeGreaterThan(4.5);
  });
});
it("exports at 1024 on a printable light background with the logo", () => {
  const options = qrOptions(hash, false, "logo", 1024);
  expect(options).toMatchObject({
    width: 1024,
    height: 1024,
    image: "logo",
    backgroundOptions: { color: "#ffffff" },
    imageOptions: { margin: 8, imageSize: 0.26 },
  });
});
