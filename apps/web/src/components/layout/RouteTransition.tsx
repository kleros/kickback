import type { ReactNode } from "react";

/** Each route fades in with a 6px rise; app/template.tsx remounts it on navigation. */
export function RouteTransition({ children }: { children: ReactNode }) {
  return <div className="kb-route">{children}</div>;
}
