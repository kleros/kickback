import Link from "next/link";
import type { ReactNode } from "react";

import { ChainClock } from "@/components/ChainClock";

import { paths } from "@/config/paths";
import { siteConfig } from "@/config/site";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="kb-page flex flex-wrap items-center justify-between gap-4 py-4">
        <Link href={paths.home.getHref()} className="type-h2 text-klerosUIComponentsPrimaryText">
          {siteConfig.name}
        </Link>
        <ChainClock />
      </header>
      <main className="kb-page flex-1 py-10">{children}</main>
    </>
  );
}
