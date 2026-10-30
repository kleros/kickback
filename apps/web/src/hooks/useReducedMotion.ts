"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const subscribe = (onChange: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/** Read once per call site, for JS-driven motion that CSS media queries cannot reach. */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches;

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

const FINE = "(hover: hover) and (pointer: fine)";

/** A mouse or trackpad: hover-only effects are skipped on touch. */
export const hasFinePointer = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(FINE).matches;
