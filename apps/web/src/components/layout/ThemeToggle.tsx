"use client";

import { useEffect, useState } from "react";

import { useTheme } from "next-themes";
import { Button } from "react-aria-components";

import { MoonIcon, SunIcon } from "@/components/ui/icons";

/** Light or dark; the icon cross-blurs between the two. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      className="kb-icon-btn"
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      onPress={() => setTheme(dark ? "light" : "dark")}
    >
      <span className="kb-swap" aria-hidden>
        <SunIcon data-off={dark ? undefined : ""} />
        <MoonIcon data-off={dark ? "" : undefined} />
      </span>
    </Button>
  );
}
