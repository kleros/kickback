import Link from "next/link";

import { GlassCard } from "@/components/ui/GlassCard";

import { paths } from "@/config/paths";

import type { RefusalReason } from "../api/useEvent";

const BODY: Record<RefusalReason, string> = {
  "not-address": "This link has no event address in it.",
  "no-contract": "There is no event at this address.",
  "not-kickback": "This address is not a contract we can verify.",
  "look-alike": "This contract looks like a Kickback event, but this site did not create it.",
};

/** Shown instead of the deposit card for anything that is not a verified Kickback event. */
export function Refusal({ reason, address }: { reason: RefusalReason; address: string }) {
  return (
    <div className="kb-narrow">
      <GlassCard as="section" className="kb-refusal" data-testid="refusal" data-reason={reason}>
        <h1>This link is not a verified event</h1>
        <p>{BODY[reason]}</p>
        {address && <span className="addr kb-mono">{address}</span>}
        <p>Check the link on the event&apos;s Luma page.</p>
        <p>
          <Link className="kb-link" href={paths.home.getHref()}>
            Go to the home page
          </Link>
        </p>
      </GlassCard>
    </div>
  );
}
