import { redirect } from "next/navigation";

import { DEFAULT_EVENT } from "@/config/event";
import { paths } from "@/config/paths";

/** `/event` opens the live event; legacy `/event?contract=…&from=…` links keep working. */
export default function EventIndex({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const contract = one(searchParams.contract);
  const from = one(searchParams.from);
  redirect(contract ? paths.event.getHref(contract, from) : paths.event.getHref(DEFAULT_EVENT.contract));
}
