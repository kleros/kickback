"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { KickbackMark } from "@/components/ui/icons";
import { WalletChip } from "@/components/wallet/WalletChip";

import { isSepolia } from "@/config/chains";
import { paths } from "@/config/paths";
import { siteConfig } from "@/config/site";

import { ThemeToggle } from "./ThemeToggle";

/** Wordmark and wallet; clear over the aurora at the top, frosted once the page scrolls. */
export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="kb-header" data-scrolled={scrolled ? "" : undefined}>
      <div className="kb-page kb-header-row">
        <Link href={paths.home.getHref()} className="kb-wordmark">
          <KickbackMark />
          {siteConfig.name}
        </Link>
        <div className="kb-header-right">
          {isSepolia && (
            <span className="kb-test-pill" data-testid="test-chain">
              Sepolia test
            </span>
          )}
          <WalletChip />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
