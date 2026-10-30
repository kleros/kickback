"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/utils/cn";

/**
 * A number whose changed digits pop in (transitions.dev 02). On first show every digit pops,
 * staggered, unless `still` is set. Digits shared with the previous value stay put.
 */
export function NumberPop({ value, className, still = false }: { value: string; className?: string; still?: boolean }) {
  const previous = useRef<string | null>(still ? value : null);
  const [run, setRun] = useState(0);
  const [prev, setPrev] = useState<string | null>(previous.current);

  useEffect(() => {
    if (previous.current === value) return;
    setPrev(previous.current);
    previous.current = value;
    setRun((n) => n + 1);
  }, [value]);

  const chars = [...value];
  const shared = prev === null ? 0 : sharedPrefix(prev, value);

  return (
    <span
      key={run}
      className={cn("t-digit-group kb-num", run > 0 && "is-animating", className)}
      aria-label={value}
      role="text"
      data-value={value}
    >
      {chars.map((char, i) => (
        <span
          key={i}
          aria-hidden
          className="t-digit"
          data-same={i < shared ? "" : undefined}
          style={{ ["--i" as string]: i - shared }}
        >
          {char}
        </span>
      ))}
    </span>
  );
}

const sharedPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.length === b.length ? i : 0;
};
