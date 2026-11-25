"use client";

import Link from "next/link";

import { CopyPrimaryButton } from "@/components/ui/CopyButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { NumberPop } from "@/components/ui/NumberPop";

import { isShowableTime } from "@/utils/time";

import { paths } from "@/config/paths";

import { Figures } from "./parts";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { NEXT_STEP } from "../model/phase";
import { assetText } from "../model/view";

const when = (unix: number) =>
  isShowableTime(unix)
    ? new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
      }).format(new Date(unix * 1000))
    : "date out of range";

export function OverviewScreen({ court }: { court: string }) {
  const { overview, phase, address } = useOrganiserEvent();
  const data = overview.data;
  if (!data || !phase) return <p className="og-note">Reading the event…</p>;
  const { event } = data;
  const step = NEXT_STEP[phase];
  const guestLink = `${typeof window === "undefined" ? "" : window.location.origin}${paths.event.getHref(address)}`;
  const deadline =
    phase === "Booking open"
      ? `Bookings open until ${when(event.eventEnd)}`
      : phase === "Attendance due" || phase === "Adding names"
        ? `Confirm who came by ${when(event.claimDeadline)}`
        : phase === "Challenge window"
          ? `Challenges close ${when(event.challengeEndsAt)}`
          : null;
  const open = data.challenges.filter((c) => c.state === 1 || c.state === 2).length;
  return (
    <div className="flex flex-col gap-6" data-testid="overview">
      <div className="flex flex-col gap-1">
        <p className="og-hero-phase" data-testid="overview-phase">
          {phase}
        </p>
        {deadline && <p className="og-lede">{deadline}</p>}
      </div>
      <GlassCard as="section" className="og-card" data-testid="next-step">
        <span className="og-kicker">Next</span>
        <div className="flex flex-col gap-1">
          <h2 className="og-h2">{step.title}</h2>
          <p className="og-lede">{step.detail}</p>
        </div>
        {phase === "Booking open" && (
          <div className="flex flex-col gap-2" data-testid="guest-link">
            <span className="og-label">Guest link</span>
            <code className="og-input is-mono break-all">{guestLink}</code>
            <CopyPrimaryButton value={guestLink}>Copy guest link</CopyPrimaryButton>
            <p className="og-note">
              Bookmark this organiser page too. If you lose it, connect this wallet on Organise to find your events.
            </p>
          </div>
        )}
        {step.tab && (
          <div className="og-actions">
            <Link
              href={paths.organiseEvent.getHref(address, undefined, step.tab)}
              className="kb-btn"
              data-testid="next-action"
            >
              {step.title}
            </Link>
          </div>
        )}
      </GlassCard>
      <Figures
        big
        testId="counts"
        rows={[
          { label: "Booked", value: <NumberPop value={String(event.stakerCount)} still /> },
          {
            label: "Attendees",
            value:
              event.phase === 0 || event.phase === 3 ? "—" : <NumberPop value={String(event.attendeeCount)} still />,
          },
          { label: "Challenges", value: <NumberPop value={String(open)} still /> },
          {
            label: "Pool",
            value: (
              <span className="text-base">{assetText(event.depositAmount * BigInt(event.stakerCount), event)}</span>
            ),
          },
        ]}
      />
      <Figures
        rows={[
          { label: "Deposit", value: assetText(event.depositAmount, event) },
          { label: "Capacity", value: event.capacity ? String(event.capacity) : "No limit" },
          { label: "Starts", value: when(event.eventStart) },
          { label: "Ends · bookings close", value: when(event.eventEnd) },
          { label: "Confirm who came by", value: when(event.claimDeadline) },
          { label: "Disputes", value: court },
        ]}
      />
    </div>
  );
}
