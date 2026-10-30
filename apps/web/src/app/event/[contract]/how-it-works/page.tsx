import { redirect } from "next/navigation";

import { paths } from "@/config/paths";

/** How it works lives on the event page, below the card. */
export default function HowItWorksRedirect({ params }: { params: { contract: string } }) {
  redirect(paths.howItWorks.getHref(params.contract));
}
