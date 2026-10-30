import { GlassCard } from "@/components/ui/GlassCard";

/** The ticket's footprint while the event loads, so nothing below it moves. */
export function TicketSkeleton() {
  return (
    <div className="kb-narrow" aria-busy="true" aria-label="Loading the event">
      <div className="ev-head">
        <div className="kb-skel" style={{ height: 30, width: "60%", margin: "3px 0" }} />
        <div className="kb-skel" style={{ height: 16, width: "45%", marginTop: 10 }} />
      </div>
      <GlassCard as="section" className="kb-ticket" data-testid="ticket-skeleton">
        <div className="tk-label">
          <div className="kb-skel" style={{ height: 12, width: 120 }} />
        </div>
        <div className="tk-hero">
          <div className="kb-skel" style={{ height: 40, width: 140 }} />
        </div>
        <hr className="tk-hair" />
        <div className="tk-slot">
          <div className="kb-skel" style={{ height: 12, width: 150 }} />
        </div>
        <div className="tk-btn">
          <div className="kb-skel" style={{ height: 52, borderRadius: 14 }} />
        </div>
        <div className="tk-foot" />
        <div className="tk-verified" style={{ height: 45 }} />
      </GlassCard>
    </div>
  );
}
