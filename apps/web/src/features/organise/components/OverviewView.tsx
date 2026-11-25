"use client";

import Link from "next/link";
import { useState } from "react";

import { CopyButton } from "@/components/ui/CopyButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";
import { NumberPop } from "@/components/ui/NumberPop";

import { isShowableTime } from "@/utils/time";

import { paths } from "@/config/paths";

import { Messages } from "./Messages";
import { ConfirmDialog, Figures } from "./parts";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { NEXT_STEP } from "../model/phase";
import { assetText, TYPED_WORDS } from "../model/view";
import { tx } from "../operations/tx";

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

const LUMA_SETUP = [
  "Copy the guest link and put it in your Luma ticket's description.",
  'On that Luma ticket, turn on "Require approval" and "Require Ethereum wallet", and add a required question: "Paste your Kickback deposit link".',
  "Guests deposit, then paste their transaction link in the Luma request.",
  "Approve each request that has a deposit; you can check them on the Guests tab.",
];

export function OverviewScreen({ court }: { court: string }) {
  const event = useOrganiserEvent();
  const { overview, phase, address } = event;
  const [cancel, setCancel] = useState(false);
  const data = overview.data;
  if (!data || !phase) return <p className="og-note">Reading the event…</p>;
  const info = data.event;
  const open = data.challenges.filter((c) => c.state === 1 || c.state === 2).length;
  // nothing to answer yet: say when to come back instead
  const step =
    phase === "Challenge window" && open === 0
      ? {
          title: "Come back to release payouts",
          detail: `No challenges so far. After ${when(info.challengeEndsAt)}, release payouts on the Payout tab.`,
          tab: "payout" as const,
        }
      : NEXT_STEP[phase];
  const booking = phase === "Booking open" || phase === "Live now";
  const guestLink = `${typeof window === "undefined" ? "" : window.location.origin}${paths.event.getHref(address)}`;
  const deadline =
    phase === "Booking open"
      ? `Starts ${when(info.eventStart)} · deposits open until the end`
      : phase === "Live now"
        ? `The event is on · walk-ins can deposit until ${when(info.eventEnd)}`
        : phase === "Attendance due" || phase === "Adding names"
          ? `Confirm who came by ${when(info.claimDeadline)}`
          : phase === "Challenge window"
            ? `Challenges close ${when(info.challengeEndsAt)}`
            : null;

  const canCancel = event.isOwner && info.phase === 0 && data.now <= info.claimDeadline;
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
        {booking && (
          <div className="flex flex-col gap-2" data-testid="guest-link">
            <span className="og-label">Guest link</span>
            <div className="og-linkbox">
              <code title={guestLink}>{guestLink}</code>
              <CopyButton value={guestLink} label="Copy guest link" />
            </div>
          </div>
        )}
        {phase === "Booking open" && (
          <ol className="og-steps" aria-label="Set up Luma">
            {LUMA_SETUP.map((text, i) => (
              <li key={text} className="og-step">
                <span className="og-step-n">{i + 1}</span>
                <span>{text}</span>
              </li>
            ))}
            <li className="og-step">
              <span className="og-step-n">!</span>
              <span>On the day, scan every guest&apos;s Luma QR code: only checked-in guests count as attendees.</span>
            </li>
          </ol>
        )}
        {step.tab && (
          <div className="og-actions">
            <Link
              href={`${paths.organiseEvent.getHref(address, undefined, step.tab)}${step.tab === "guests" ? "#check" : ""}`}
              className="kb-btn"
              data-testid="next-action"
              prefetch
              onClick={() => window.scrollTo({ top: 0 })}
            >
              {step.title}
            </Link>
          </div>
        )}
        {booking && (
          <p className="og-note">
            Bookmark this organiser page. If you lose it, connect this wallet on Organise to find your events.
          </p>
        )}
      </GlassCard>
      <Figures
        big
        testId="counts"
        rows={[
          { label: "Deposits", value: <NumberPop value={String(info.stakerCount)} still /> },
          {
            label: "Confirmed attendees",
            value: info.phase === 0 || info.phase === 3 ? "—" : <NumberPop value={String(info.attendeeCount)} still />,
          },
          { label: "Open challenges", value: <NumberPop value={String(open)} still /> },
          { label: "Deposits held", value: assetText(info.depositAmount * BigInt(info.stakerCount), info) },
        ]}
      />
      <section className="flex flex-col gap-2">
        <h2 className="og-h2">Event details</h2>
        <Figures
          rows={[
            { label: "Deposit", value: assetText(info.depositAmount, info) },
            { label: "Capacity", value: info.capacity ? String(info.capacity) : "No limit" },
            { label: "Starts", value: when(info.eventStart) },
            { label: "Ends · deposits close", value: when(info.eventEnd) },
            { label: "Confirm who came by", value: when(info.claimDeadline) },
            { label: "Disputes", value: court },
          ]}
        />
      </section>
      {canCancel && (
        <section className="og-danger flex flex-col gap-2" data-testid="danger-zone">
          <h2 className="og-h2">Cancel the event</h2>
          <p className="og-note">
            Every guest who deposited can then withdraw their full deposit. This cannot be undone.
          </p>
          <div>
            <GradientButton className="is-quiet" isDisabled={event.busy} onPress={() => setCancel(true)}>
              Cancel the event
            </GradientButton>
          </div>
        </section>
      )}
      <Messages event={event} />
      {cancel && (
        <ConfirmDialog
          isOpen
          title="Cancel the event"
          intro="Every guest who deposited can then withdraw their full deposit. This cannot be undone."
          words={[TYPED_WORDS.cancel]}
          figures={[{ label: "Guests with deposits", value: String(info.stakerCount) }]}
          action="Cancel the event"
          busy={event.busy}
          error={null}
          onClose={() => setCancel(false)}
          onConfirm={() => {
            setCancel(false);
            event.run(
              "Cancel",
              () => tx.cancel(info.contract),
              "The event is cancelled. Guests can now withdraw their deposits.",
            );
          }}
        />
      )}
    </div>
  );
}
