"use client";

import { useEffect, useRef, useState } from "react";

import type QRCodeStyling from "qr-code-styling";

const options = (data: string, size: number) =>
  ({
    type: "svg",
    width: size,
    height: size,
    data,
    margin: size / 14,
    qrOptions: { errorCorrectionLevel: "M", mode: "Byte" },
    dotsOptions: { type: "rounded", color: "#2b1866" },
    cornersSquareOptions: { type: "extra-rounded", color: "#6c2ff2" },
    cornersDotOptions: { type: "dot", color: "#6c2ff2" },
    backgroundOptions: { color: "#ffffff" },
  }) as const;

/** The guest link as a QR code: walk-ins scan it at the door; downloads as a PNG for a sign. */
export function DoorQr({ link, name }: { link: string; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let qr: QRCodeStyling | undefined;
    let gone = false;
    void import("qr-code-styling").then(({ default: QR }) => {
      if (gone || !box.current) return;
      qr = new QR(options(link, 148));
      box.current.replaceChildren();
      qr.append(box.current);
      setReady(true);
    });
    return () => {
      gone = true;
    };
  }, [link]);

  const download = async () => {
    const { default: QR } = await import("qr-code-styling");
    const blob = await new QR({ ...options(link, 1200), type: "canvas" }).getRawData("png");
    if (!(blob instanceof Blob)) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\w-]+/g, "-").toLowerCase() || "event"}-guest-qr.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="og-qr" data-testid="door-qr">
      <div ref={box} className="og-qr-code" aria-label="QR code of the guest link" role="img" aria-busy={!ready} />
      <div className="flex flex-col gap-1">
        <span className="og-label">For walk-ins</span>
        <p className="og-note">Guests scan this to reach the deposit page. Print it or show it at the door.</p>
        <button type="button" className="kb-link self-start text-sm" disabled={!ready} onClick={() => void download()}>
          Download PNG for a door sign
        </button>
      </div>
    </div>
  );
}
