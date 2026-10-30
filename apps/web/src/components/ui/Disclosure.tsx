"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "react-aria-components";

import { cn } from "@/utils/cn";

import { ChevronIcon } from "./icons";

const INERT = { inert: "" };

export interface DisclosureProps {
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/** Grows its body with grid rows 0fr→1fr; the body stays mounted and inert while closed. */
export function Disclosure({ title, icon, children, defaultOpen = false, className }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className={cn("kb-disc", className)} data-open={open ? "" : undefined}>
      <Button className="kb-disc-trigger" aria-expanded={open} aria-controls={id} onPress={() => setOpen((v) => !v)}>
        {icon}
        <span>{title}</span>
        <ChevronIcon className="chev" />
      </Button>
      <div className="kb-disc-panel" id={id} role="region" aria-hidden={!open}>
        {/* React 18 writes `inert` only from an empty string */}
        <div className="kb-disc-inner" {...(open ? {} : (INERT as object))}>
          {children}
        </div>
      </div>
    </div>
  );
}
