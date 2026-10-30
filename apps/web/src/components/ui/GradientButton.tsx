"use client";

import type { ReactNode } from "react";

import { Button, Link, type ButtonProps } from "react-aria-components";

import { cn } from "@/utils/cn";

import { ArcGlyph, CheckIcon, RingGlyph } from "./icons";
import { TextSwap } from "./TextSwap";

export type ButtonGlyph = "ring" | "arc" | "success";

interface CommonProps {
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

export interface GradientButtonProps extends CommonProps, Omit<ButtonProps, "children" | "className"> {}

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

export interface GradientLinkProps extends CommonProps {
  href: string;
  external?: boolean;
}

/** The primary action as a link, styled as the gradient button. */
export function GradientLink({ children, wide, className, glyph, icon, href, external }: GradientLinkProps) {
  return (
    <Link
      href={href}
      className={cn("kb-btn", wide && "is-wide", className)}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <Glyph glyph={glyph} />
      <TextSwap>{children}</TextSwap>
      {icon}
    </Link>
  );
}
