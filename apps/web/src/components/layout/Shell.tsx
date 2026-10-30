import type { ReactNode } from "react";

import { Aurora } from "./Aurora";
import { Header } from "./Header";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Aurora />
      <Header />
      <main className="kb-main kb-page">{children}</main>
    </>
  );
}
