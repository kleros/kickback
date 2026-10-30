"use client";

import type { ReactNode } from "react";

import { Button, type ButtonProps } from "react-aria-components";

import { cn } from "@/utils/cn";

import { ArcGlyph, CheckIcon, RingGlyph } from "./icons";
import { TextSwap } from "./TextSwap";

export type ButtonGlyph = "ring" | "arc" | "success";

export interface GradientButtonProps extends Omit<ButtonProps, "children" | "className"> {
  /** The label, which stays visible in every state and swaps in place when it changes. */
  children: string;
  wide?: boolean;
  className?: string;
  /** Busy: the user's turn (ring) or the chain's (arc); success shows the check pop-in. */
  glyph?: ButtonGlyph;
  icon?: ReactNode;
}

function Glyph({ glyph }: { glyph?: ButtonGlyph }) {
  if (!glyph) return null;
  return (
    <span className="kb-btn-glyph" data-glyph={glyph}>
      {glyph === "ring" ? (
        <RingGlyph />
      ) : glyph === "arc" ? (
        <ArcGlyph />
      ) : (
        <span className="t-success-check" data-state="in">
          <CheckIcon size={20} strokeWidth={2.25} />
        </span>
      )}
    </span>
  );
}

/** The primary action: gradient fill, press scale, label swap, a spinner beside the label while busy. */
export function GradientButton({ children, wide, className, glyph, icon, isPending, ...props }: GradientButtonProps) {
  return (
    <Button {...props} isPending={isPending} className={cn("kb-btn", wide && "is-wide", className)} data-glyph={glyph}>
      <Glyph glyph={glyph} />
      <TextSwap>{children}</TextSwap>
      {icon}
    </Button>
  );
}
