"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/utils/cn";

export interface SegmentedNavItem {
  href: string;
  label: string;
}

/** Route tabs with one pill that slides to the current item (transitions.dev 16). */
export function SegmentedNav({
  items,
  current,
  label,
  className,
}: {
  items: readonly SegmentedNavItem[];
  current: string;
  label: string;
  className?: string;
}) {
  const bar = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<CSSProperties | null>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const place = () => {
      const active = bar.current?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return setPill(null);
      // the first placement must not animate in from 0
      const style: CSSProperties = { width: active.offsetWidth, transform: `translateX(${active.offsetLeft}px)` };
      setPill(placed.current ? style : { ...style, transition: "none" });
      placed.current = true;
    };
    place();
    const observer = new ResizeObserver(place);
    if (bar.current) observer.observe(bar.current);
    return () => observer.disconnect();
  }, [current, items]);

  return (
    <nav ref={bar} aria-label={label} className={cn("kb-seg", className)}>
      {pill && <span className="kb-seg-pill" style={pill} aria-hidden />}
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch
          className="kb-seg-item"
          aria-current={item.href === current ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
