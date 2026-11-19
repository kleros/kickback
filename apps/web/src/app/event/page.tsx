import { redirect } from "next/navigation";

import { paths } from "@/config/paths";

/** `/event?contract=…` links keep working; without a contract, the home page lists the events. */
export default function EventIndex({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const contract = one(searchParams.contract);
  redirect(contract ? paths.event.getHref(contract) : paths.home.getHref());
}
