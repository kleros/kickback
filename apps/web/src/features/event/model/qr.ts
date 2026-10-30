import type { Options } from "qr-code-styling";

export const QR_PALETTES = {
  light: { start: "#6c2ff2", end: "#3a5ef0", background: "#ffffff" },
  dark: { start: "#7744d5", end: "#4968cc", background: "#f6f4ff" },
};

export function qrOptions(data: string, dark: boolean, image?: string, size = 256): Options {
  const palette = dark ? QR_PALETTES.dark : QR_PALETTES.light;
  const gradient = {
    type: "linear" as const,
    rotation: Math.PI / 4,
    colorStops: [
      { offset: 0, color: palette.start },
      { offset: 1, color: palette.end },
    ],
  };
  return {
    type: "svg",
    width: size,
    height: size,
    data,
    image,
    margin: size / 12,
    qrOptions: { errorCorrectionLevel: "H", mode: "Byte" },
    dotsOptions: { type: "rounded", gradient },
    cornersSquareOptions: { type: "extra-rounded", gradient },
    cornersDotOptions: { type: "dot", gradient },
    backgroundOptions: { color: palette.background },
    // The library sizes the image against H's 30% error-correction area, not the canvas width.
    imageOptions: { imageSize: 0.26, margin: size / 128, hideBackgroundDots: true, saveAsBlob: false },
  };
}
