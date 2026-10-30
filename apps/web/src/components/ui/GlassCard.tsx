"use client";

import { forwardRef, type CSSProperties, type HTMLAttributes, type PointerEvent } from "react";

import { cn } from "@/utils/cn";
import { hasFinePointer } from "@/utils/media";

export interface GlassCardProps extends HTMLAttributes<HTMLElement> {
  as?: "section" | "div" | "article";
  /** Hover lift plus an edge highlight that follows the cursor, on a mouse or trackpad only. */
  interactive?: boolean;
  /** The 1px edge stroke, e.g. the gradient axis on a card that carries the deposit. */
  edge?: string;
}

export const GlassCard = forwardRef<HTMLElement, GlassCardProps>(function GlassCard(
  { as: Tag = "div", interactive, edge, className, style, onPointerMove, ...props },
  ref,
) {
  const track = (event: PointerEvent<HTMLElement>) => {
    onPointerMove?.(event);
    if (!interactive || !hasFinePointer()) return;
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--kb-mx", `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty("--kb-my", `${event.clientY - box.top}px`);
  };

  return (
    <Tag
      ref={ref as never}
      className={cn("kb-glass", className)}
      data-interactive={interactive ? "" : undefined}
      style={{ ...(edge ? { "--kb-edge": edge } : {}), ...style } as CSSProperties}
      onPointerMove={track}
      {...props}
    />
  );
});
