import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { Shell } from "@/components/layout/Shell";
import { AppProviders } from "@/components/providers/AppProviders";
import Web3Providers from "@/components/providers/Web3Providers";

import { env } from "@/config/env";
import { siteConfig } from "@/config/site";

import "react-toastify/dist/ReactToastify.css";
import "@/styles/global.css";

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
  metadataBase: env.SITE_URL ? new URL(env.SITE_URL) : null,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#060a19" },
  ],
};

const FONTS = "../../../../node_modules/@fontsource";

const hostGrotesk = localFont({
  variable: "--font-host-grotesk",
  display: "swap",
  src: [
    { path: `${FONTS}/host-grotesk/files/host-grotesk-latin-400-normal.woff2`, weight: "400" },
    { path: `${FONTS}/host-grotesk/files/host-grotesk-latin-500-normal.woff2`, weight: "500" },
    { path: `${FONTS}/host-grotesk/files/host-grotesk-latin-600-normal.woff2`, weight: "600" },
  ],
});

const geistMono = localFont({
  variable: "--font-geist-mono",
  display: "swap",
  src: [
    { path: `${FONTS}/geist-mono/files/geist-mono-latin-400-normal.woff2`, weight: "400" },
    { path: `${FONTS}/geist-mono/files/geist-mono-latin-500-normal.woff2`, weight: "500" },
  ],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hostGrotesk.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <AppProviders>
          <Web3Providers>
            <Shell>{children}</Shell>
          </Web3Providers>
        </AppProviders>
      </body>
    </html>
  );
}
