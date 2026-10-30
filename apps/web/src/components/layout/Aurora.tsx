"use client";

import { usePathname } from "next/navigation";

/** Blurred blobs behind every page, with a glow tinted for the guest or the organiser side. */
export function Aurora() {
  const pathname = usePathname() ?? "/";
  const tint = pathname.startsWith("/organise") ? "organiser" : "guest";

  return (
    <div className="kb-aurora" data-tint={tint} aria-hidden data-testid="aurora">
      <i className="b1" />
      <i className="b2" />
      <i className="b3" />
    </div>
  );
}
