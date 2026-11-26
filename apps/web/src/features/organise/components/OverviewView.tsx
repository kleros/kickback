"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/ui/CopyButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";
import { NumberPop } from "@/components/ui/NumberPop";

import { paths } from "@/config/paths";

import { Messages } from "./Messages";
import { ConfirmDialog, Figures } from "./parts";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { NEXT_STEP, type NextStep } from "../model/phase";
import { assetText, TYPED_WORDS, when } from "../model/view";
import { tx } from "../operations/tx";

const LUMA_SETUP = [
  "Copy the guest link and put it in your Luma ticket's description.",
  "On that Luma ticket, turn on “Require approval” and “Require Ethereum wallet”, and add a required question: “Paste your Kickback deposit link”.",
  "Guests deposit, then paste their deposit link in their Luma registration.",
  "Approve each request that has a deposit; you can check them on the Guests tab.",
];

export function OverviewScreen({ court }: { court: string }) {
  const event = useOrganiserEvent();
  const { overview, phase, address } = event;
  const [cancel, setCancel] = useState(false);
  // the dialog belongs to the wallet that opened it: close it on Disconnect, an account or a network switch
  const accountKey = event.account?.toLowerCase();
  useEffect(() => setCancel(false), [accountKey, event.onChain]);
  const data = overview.data;
  if (!data || !phase) return <p className="og-note">Loading the event…</p>;
  const info = data.event;
  const open = data.challenges.filter((c) => c.state === 1 || c.state === 2).length;
  // a late challenge can still be inside its answer time after the window: releasePayouts waits for it
  const waiting = data.challenges.filter((c) => c.state === 1 && data.now <= c.matchEndsAt);
  const lastAnswer = Math.max(0, ...waiting.map((c) => c.matchEndsAt));
  // nothing to answer yet: say when to come back instead
  const step: NextStep =
    phase === "Challenges pending" && waiting.length > 0
      ? {
          title: "Answer challenges",
          detail: `The challenge window is over, but ${waiting.length === 1 ? "1 challenge is" : `${waiting.length} challenges are`} ${event.isOwner ? "still waiting for your answer. If a guest did not come, send their case to Kleros. If they came, do nothing: they will be added when payouts are released." : "still waiting for the organiser's answer."} You can release payouts after ${when(lastAnswer)}.`,
          tab: "payout",
          action: "Open Payout",
        }
      : phase === "Challenge window" && open === 0
        ? {
            title: "Release payouts after the challenge window",
            detail: `${data.challenges.length ? "No open challenges." : "No challenges so far."} After ${when(info.challengeEndsAt)}, release payouts on the Payout tab.`,
            tab: null,
            action: null,
          }
        : phase === "Payouts released" && info.openCases > 0
          ? {
              title: "Settle the Kleros cases",
              detail:
                "A share is held for each open case. Settle each ruling on the Payout tab once the jurors decide.",
              tab: "payout",
              action: "Open Payout",
            }
          : phase === "Payouts released" && data.unpaid.length === 0
            ? {
                title: "All done",
                detail: "Every attendee's share has been sent or can be claimed on the guest page.",
                tab: null,
                action: null,
                done: true,
              }
            : NEXT_STEP[phase];
  const booking = phase === "Deposits open" || phase === "Live now";
  const guestLink = `${typeof window === "undefined" ? "" : window.location.origin}${paths.event.getHref(address)}`;
  const deadline =
    phase === "Deposits open"
      ? `Starts ${when(info.eventStart)} · deposits stay open until it ends`
      : phase === "Live now"
        ? `The event is under way · walk-ins can deposit until ${when(info.eventEnd)}`
        : phase === "Attendance due" || phase === "List not closed"
          ? `Confirm who came by ${when(info.claimDeadline)}`
          : phase === "Challenge window"
            ? `Challenges close ${when(info.challengeEndsAt)}`
            : phase === "Challenges pending" && waiting.length > 0
              ? `Answer by ${when(lastAnswer)}`
              : null;

  const canCancel = event.isOwner && event.onChain && info.phase === 0 && data.now <= info.claimDeadline;
  return (
    <div className="flex flex-col gap-6" data-testid="overview">
      <div className="flex flex-col gap-1">
        <h2 className="kb-h1">Overview</h2>
        {deadline && <p className="og-lede">{deadline}</p>}
      </div>
      <GlassCard as="section" className="og-card" data-testid="next-step">
        <span className="og-kicker">{step.done ? "Status" : "Next"}</span>
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
        {phase === "Deposits open" && (
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
        {step.tab && step.action && (
          <div className="og-actions">
            <Link
              href={`${paths.organiseEvent.getHref(address, undefined, step.tab)}${step.tab === "guests" ? "#check" : ""}`}
              className="kb-btn"
              data-testid="next-action"
              prefetch
              onClick={() => window.scrollTo({ top: 0 })}
            >
              {step.action}
            </Link>
          </div>
        )}
        {booking && (
          <p className="og-note">
            Bookmark this organiser page. If you lose it, open{" "}
            <Link href={paths.organise.getHref()} className="kb-link">
              Manage your events
            </Link>{" "}
            and connect the wallet you created the event with.
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
            value:
              info.phase === 3 || (info.phase === 0 && info.attendeeCount === 0) ? (
                "—"
              ) : (
                <NumberPop value={String(info.attendeeCount)} still />
              ),
          },
          { label: "Open challenges", value: <NumberPop value={String(open)} still /> },
          { label: "Deposits held", value: assetText(info.reservedPool, info) },
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
      {cancel && canCancel && (
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
