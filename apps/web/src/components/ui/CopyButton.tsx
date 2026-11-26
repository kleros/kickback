"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "react-aria-components";

import { cn } from "@/utils/cn";

import { CheckIcon, CopyIcon } from "./icons";
import { TextSwap } from "./TextSwap";

const COPIED_MS = 1800;

/** The old copy command, for wallet in-app browsers that block the clipboard API. */
function copyByCommand(text: string) {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // 16px keeps iOS from zooming in; off screen so nothing flashes
  area.style.cssText = "position:fixed;top:0;left:-9999px;font-size:16px;opacity:0";
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export async function writeClipboard(text: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyByCommand(text);
  }
}

function useCopied(onFailed?: () => void) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    clearTimeout(timer.current);
    if (!(await writeClipboard(text))) {
      setCopied(false);
      setFailed(true);
      onFailed?.();
      return;
    }
    setFailed(false);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  return { copied, failed, copy };
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

/** A small icon button that morphs into a check, and says "Copied" (or "Could not copy") to screen readers. */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const { copied, failed, copy } = useCopied();
  return (
    <Button
      className={cn("kb-icon-btn is-small", className)}
      aria-label={copied ? "Copied" : failed ? "Could not copy" : label}
      data-copied={copied ? "" : undefined}
      data-failed={failed ? "" : undefined}
      onPress={() => void copy(value)}
    >
      <SwapIcon copied={copied} size={16} />
    </Button>
  );
}

/** The wide primary form: the gradient button whose label swaps to "Copied" with a check. */
export function CopyPrimaryButton({
  value,
  children,
  onFailed,
}: {
  value: string;
  children: string;
  /** Called when the browser refused to copy, so the page can show the text to copy by hand. */
  onFailed?: () => void;
}) {
  const { copied, failed, copy } = useCopied(onFailed);
  return (
    <Button
      className="kb-btn is-wide"
      data-copied={copied ? "" : undefined}
      data-failed={failed ? "" : undefined}
      onPress={() => void copy(value)}
    >
      <span className="kb-btn-glyph">
        <SwapIcon copied={copied} size={20} />
      </span>
      <TextSwap>{copied ? "Copied" : failed ? "Could not copy. Try again" : children}</TextSwap>
    </Button>
  );
}

/** A quiet button with its own label that copies `value`: "Copy 3 emails to approve". */
export function CopyTextButton({ value, children }: { value: string; children: string }) {
  const { copied, failed, copy } = useCopied();
  return (
    <Button
      className="kb-btn is-quiet"
      data-copied={copied ? "" : undefined}
      data-failed={failed ? "" : undefined}
      onPress={() => void copy(value)}
    >
      <span className="kb-btn-glyph">
        <SwapIcon copied={copied} size={16} />
      </span>
      <TextSwap>{copied ? "Copied" : failed ? "Could not copy" : children}</TextSwap>
    </Button>
  );
}
