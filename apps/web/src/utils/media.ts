const matches = (query: string) =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;

/** Read at the moment of use, for JS-driven motion that CSS media queries cannot reach. */
export const prefersReducedMotion = () => matches("(prefers-reduced-motion: reduce)");

/** A mouse or trackpad: hover-only effects are skipped on touch. */
export const hasFinePointer = () => matches("(hover: hover) and (pointer: fine)");
