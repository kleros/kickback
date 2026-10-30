import type { Metadata } from "next";
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

const inter = localFont({
  variable: "--font-inter",
  display: "swap",
  src: [
    { path: "../../../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2", weight: "400" },
    { path: "../../../../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2", weight: "500" },
    { path: "../../../../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2", weight: "600" },
    { path: "../../../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2", weight: "700" },
  ],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="bg-klerosUIComponentsLightBackground flex min-h-screen flex-col antialiased">
        <AppProviders>
          <Web3Providers>
            <Shell>{children}</Shell>
          </Web3Providers>
        </AppProviders>
      </body>
    </html>
  );
}
