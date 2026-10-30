"use client";

import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "@/utils/media";

const EXIT_MS = 150;

/** Swaps its text in place: the old label blurs up and out, the new one rises in (transitions.dev 04). */
export function TextSwap({ children, className }: { children: string; className?: string }) {
  const [shown, setShown] = useState(children);
  const [phase, setPhase] = useState<"idle" | "exit" | "enter">("idle");
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (children === shown) return;
    if (prefersReducedMotion()) {
      setShown(children);
      return;
    }
    setPhase("exit");
    const timer = setTimeout(() => {
      setShown(children);
      setPhase("enter");
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [children, shown]);

  useEffect(() => {
    if (phase !== "enter") return;
    void ref.current?.offsetWidth;
    const frame = requestAnimationFrame(() => setPhase("idle"));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const state = phase === "exit" ? " is-exit" : phase === "enter" ? " is-enter-start" : "";
  return (
    <span ref={ref} className={`t-text-swap${state}${className ? ` ${className}` : ""}`}>
      {shown}
    </span>
  );
}
