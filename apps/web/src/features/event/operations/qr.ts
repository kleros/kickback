import logo from "@/assets/brand/kleros.svg?url";

import { qrOptions } from "../model/qr";

export async function createQr(data: string, dark: boolean, size = 256) {
  const [{ default: QRCodeStyling }, response] = await Promise.all([
    import("qr-code-styling"),
    fetch(typeof logo === "string" ? logo : logo.src),
  ]);
  if (!response.ok) throw new Error("Could not load the ticket logo.");
  const svg = (await response.text())
    .replace("<svg ", '<svg width="46" height="45" ')
    .replace('fill="none"', 'fill="#6c2ff2"');
  const image = `data:image/svg+xml;base64,${btoa(svg)}`;
  return new QRCodeStyling(qrOptions(data, dark, image, size));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadQr(data: string, extension: "png" | "svg") {
  const qr = await createQr(data, false, 1024);
  const blob = await qr.getRawData(extension);
  if (!(blob instanceof Blob)) throw new Error("Could not create the download.");
  downloadBlob(blob, `kickback-ticket.${extension}`);
}
