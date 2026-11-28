"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { ToastContainer } from "react-toastify";

import { makeQueryClient } from "@/lib/query";

/** The phone browser's toolbar colour (the page background, as in tokens.css) for each theme. */
export const THEME_COLOR = { light: "#faf8fd", dark: "#17131f" } as const;

/**
 * The browser toolbar follows the theme the visitor chose, not only the system setting: the layout's two
 * media-keyed theme-color tags are right only while the theme follows the system.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  const pathname = usePathname();
  useEffect(() => {
    if (resolvedTheme !== "dark" && resolvedTheme !== "light") return;
    const color = THEME_COLOR[resolvedTheme];
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
  }, [resolvedTheme, pathname]);
  return null;
}

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={["light", "dark"]}
    >
      <ThemeColorSync />
      <QueryClientProvider client={queryClient}>
        {children}
        <ToastContainer className="p-4 pt-17.5" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
