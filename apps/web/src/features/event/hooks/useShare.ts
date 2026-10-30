"use client";

import { useEffect, useState } from "react";

import { supportsPhoneShare } from "../model/socialShare";

export function useShare(text: string, url: string) {
  const [native, setNative] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px) and (pointer: coarse)");
    const update = () => setNative(supportsPhoneShare(navigator.share, media.matches));
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const share = async () => {
    setError(undefined);
    try {
      await navigator.share({ text, url });
    } catch (caught) {
      if (caught && typeof caught === "object" && "name" in caught && caught.name === "AbortError") return;
      setNative(false);
      setError("Could not open sharing. Choose a platform or copy the text.");
    }
  };
  return { native, share, error };
}
