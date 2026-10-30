"use client";

import Link from "next/link";

import { GlassCard } from "@/components/ui/GlassCard";
import { NumberPop } from "@/components/ui/NumberPop";

import { Figures, Locked } from "./parts";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import type { overviewModel } from "../model/phase";
import { challengeText } from "../model/view";

const tabName = (route: string) => {
  const last = route.split("/").pop() ?? "";
  return last.charAt(0).toUpperCase() + last.slice(1);
};

export type OverviewData = ReturnType<typeof overviewModel> & { verifiedKleros: boolean };

export function OverviewView({
  data,
  court,
  connected = true,
  from,
}: {
  data: OverviewData;
  court: string;
  connected?: boolean;
  from?: number;
}) {
  const { nextStep, counts, phase, deadlines } = data;
  const when =
    phase === "Deposits open" || phase === "Waiting for the event"
      ? `Deposits open until ${deadlines.depositsClose.text}`
      : phase === "Attendance due" || phase === "Past the deadline"
        ? `Attendance due by ${deadlines.attendanceDue.text}`
        : phase === "List posted" && deadlines.challengeEnds
          ? `Challenges close ${deadlines.challengeEnds.text}`
          : null;
  return (
    <div className="flex flex-col gap-6" data-testid="overview">
      <div className="flex flex-col gap-1">
        <p className="og-hero-phase" data-testid="overview-phase">
          {phase}
        </p>
        {when && <p className="og-lede">{when}</p>}
      </div>
      <GlassCard as="section" className="og-card" data-testid="next-step">
        <span className="og-kicker">Next</span>
        <div className="flex flex-col gap-1">
          <h2 className="og-h2">{nextStep.title}</h2>
          <p className="og-lede">{nextStep.detail}</p>
        </div>
        {nextStep.actionRoute && (
          <div className="og-actions">
            <Link
              href={from === undefined ? nextStep.actionRoute : `${nextStep.actionRoute}?from=${from}`}
              className={nextStep.lockedReason || !connected ? "kb-btn is-quiet" : "kb-btn"}
              data-testid="next-action"
            >
              {nextStep.lockedReason ? `Open ${tabName(nextStep.actionRoute)}` : nextStep.title}
            </Link>
            <Locked gate={{ enabled: !nextStep.lockedReason, lockedReason: nextStep.lockedReason }} />
          </div>
        )}
        {!nextStep.actionRoute && nextStep.lockedReason && (
          <Locked gate={{ enabled: false, lockedReason: nextStep.lockedReason }} />
        )}
      </GlassCard>
      <Figures
        big
        testId="counts"
        rows={[
          { label: "Deposits", value: <NumberPop value={String(counts.deposits)} still /> },
          { label: "Registered", value: <NumberPop value={String(counts.registered)} still /> },
          {
            label: "Attendees",
            value: counts.attendees === null ? "—" : <NumberPop value={String(counts.attendees)} still />,
          },
          {
            label: "Challenges",
            value: <span className="text-base">{challengeText(counts.openChallenges)}</span>,
          },
        ]}
      />
      <p className="og-note">{data.verifiedKleros ? `Verified ${court} contract` : `Court: ${court}`}</p>
    </div>
  );
}

export function OverviewScreen({ court }: { court: string }) {
  const { overview, connected, scope } = useOrganiserEvent();
  if (!overview.data) return <p className="og-note">Reading the event…</p>;
  return <OverviewView data={overview.data} court={court} connected={connected} from={scope.deployBlock} />;
}
