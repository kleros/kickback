import type { ReactNode } from "react";

import { RouteTransition } from "@/components/layout/RouteTransition";

export default function OrganiserTabTemplate({ children }: { children: ReactNode }) {
  return <RouteTransition>{children}</RouteTransition>;
}
