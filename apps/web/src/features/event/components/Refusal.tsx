import { GlassCard } from "@/components/ui/GlassCard";

import type { RefusalReason } from "../api/useEvent";

const BODY: Record<RefusalReason, string> = {
  "not-address": "This link has no event address in it.",
  "no-contract": "There is no event at this address.",
  "not-kickback": "This address is not a contract we can verify.",
  "look-alike": "This contract looks like Kickback, but it is not the Kickback contract.",
};

/** Shown instead of the deposit card for anything that is not a verified Kickback event. */
export function Refusal({ reason, address }: { reason: RefusalReason; address: string }) {
  return (
    <div className="kb-narrow">
      <GlassCard as="section" className="kb-refusal kb-rise" data-testid="refusal" data-reason={reason}>
        <h1>Not a Kickback event</h1>
        <p>{BODY[reason]}</p>
        {address && <span className="addr kb-mono">{address}</span>}
        <p>Check the link you were given.</p>
      </GlassCard>
    </div>
  );
}
