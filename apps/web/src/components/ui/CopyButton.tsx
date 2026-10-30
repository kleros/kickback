"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "react-aria-components";

import { cn } from "@/utils/cn";

import { CheckIcon, CopyIcon } from "./icons";
import { TextSwap } from "./TextSwap";

const COPIED_MS = 1800;

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    if (!(await writeClipboard(text))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  return { copied, copy };
}

function SwapIcon({ copied, size }: { copied: boolean; size: number }) {
  return (
    <span className="kb-swap" aria-hidden>
      <CopyIcon size={size} data-off={copied ? "" : undefined} />
      <CheckIcon size={size} data-off={copied ? undefined : ""} />
    </span>
  );
}

export interface CopyButtonProps {
  value: string;
  /** What is copied, for the accessible name: "Copy wallet address". */
  label: string;
  className?: string;
}

/** A small icon button that morphs into a check, and says "Copied" to screen readers. */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const { copied, copy } = useCopied();
  return (
    <Button
      className={cn("kb-icon-btn is-small", className)}
      aria-label={copied ? "Copied" : label}
      data-copied={copied ? "" : undefined}
      onPress={() => void copy(value)}
    >
      <SwapIcon copied={copied} size={16} />
    </Button>
  );
}

/** The wide primary form: the gradient button whose label swaps to "Copied" with a check. */
export function CopyPrimaryButton({ value, children }: { value: string; children: string }) {
  const { copied, copy } = useCopied();
  return (
    <Button className="kb-btn is-wide" data-copied={copied ? "" : undefined} onPress={() => void copy(value)}>
      <span className="kb-btn-glyph">
        <SwapIcon copied={copied} size={20} />
      </span>
      <TextSwap>{copied ? "Copied" : children}</TextSwap>
    </Button>
  );
}
