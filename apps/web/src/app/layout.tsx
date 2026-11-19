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
    { media: "(prefers-color-scheme: light)", color: "#faf8fd" },
    { media: "(prefers-color-scheme: dark)", color: "#17131f" },
  ],
};

const geist = localFont({
  variable: "--font-geist",
  display: "swap",
  src: [{ path: "../fonts/geist-latin.woff2", weight: "100 900" }],
});

const geistMono = localFont({
  variable: "--font-geist-mono",
  display: "swap",
  src: [{ path: "../fonts/geist-mono-latin.woff2", weight: "100 900" }],
});

const instrumentSerif = localFont({
  variable: "--font-instrument-serif",
  display: "swap",
  src: [
    { path: "../fonts/instrument-serif-regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/instrument-serif-italic.woff2", weight: "400", style: "italic" },
  ],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
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
