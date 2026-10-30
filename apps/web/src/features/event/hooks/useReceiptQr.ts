"use client";

import { useEffect, useRef, useState } from "react";

import { useTheme } from "next-themes";

import { createQr, downloadQr } from "../operations/qr";

export function useReceiptQr(data: string) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const container = ref.current;
    setReady(false);
    setError(undefined);
    void createQr(data, resolvedTheme === "dark")
      .then(async (qr) => {
        await qr.getRawData("svg");
        if (!active || !container) return;
        container.replaceChildren();
        qr.append(container);
        setReady(true);
      })
      .catch(() => {
        if (active) setError("Could not load the QR. You can still copy the transaction link.");
      });
    return () => {
      active = false;
      container?.replaceChildren();
    };
  }, [data, resolvedTheme]);
  const download = async (extension: "png" | "svg") => {
    setBusy(true);
    setError(undefined);
    try {
      await downloadQr(data, extension);
    } catch {
      setError("Could not download the QR. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return { ref, ready, error, busy, download };
}
