import Link from "next/link";
import type { ReactNode } from "react";

import { GlassCard } from "@/components/ui/GlassCard";

import type { RefusalReason } from "@/lib/presence";

import { paths } from "@/config/paths";

export const REFUSAL_BODY: Record<RefusalReason, string> = {
  "not-address": "This link does not contain a complete event address.",
  "no-contract": "There is no event at this address.",
  "not-kickback": "This address is a contract, but not a Kickback event.",
  "look-alike": "This contract looks like a Kickback event, but this site did not create it.",
};

/** Shown instead of the deposit card for anything that is not a verified Kickback event. */
export function Refusal({
  reason,
  address,
  footer,
}: {
  reason: RefusalReason;
  address: string;
  /** Replaces the guest-side "Check the link on Luma" advice (the organiser page has its own). */
  footer?: ReactNode;
}) {
  return (
    <div className="kb-narrow">
      <GlassCard as="section" className="kb-refusal" data-testid="refusal" data-reason={reason}>
        <h1>This link is not a verified event</h1>
        <p>{REFUSAL_BODY[reason]}</p>
        {address && <span className="addr kb-mono">{address}</span>}
        {footer ?? (
          <>
            <p>Check the link on the event&apos;s Luma page.</p>
            <p>
              <Link className="kb-link kb-tap" href={paths.home.getHref()}>
                Go to the home page
              </Link>
            </p>
          </>
        )}
      </GlassCard>
    </div>
  );
}
