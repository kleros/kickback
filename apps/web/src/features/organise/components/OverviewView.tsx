"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/ui/CopyButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";
import { NumberPop } from "@/components/ui/NumberPop";

import { paths } from "@/config/paths";

import { Messages } from "./Messages";
import { ConfirmDialog, Figures, TxLink } from "./parts";
import { useEventRecord } from "../hooks/useEventRecord";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { unpaidLede } from "../model/payout";
import { isFull, NEXT_STEP, type NextStep } from "../model/phase";
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
  const record = useEventRecord(address);
  const [cancel, setCancel] = useState(false);
  // the dialog belongs to the wallet that opened it: close it on Disconnect, an account or a network switch
  const accountKey = event.account?.toLowerCase();
  useEffect(() => setCancel(false), [accountKey, event.onChain]);
  const data = overview.data;
  if (!data || !phase) return <p className="og-note">Loading the event…</p>;
  const info = data.event;
  const open = data.challenges.filter((c) => c.state === 1 || c.state === 2).length;
  // a late challenge can still be inside its answer time after the window: releasePayouts waits for it
  const now = event.now ?? data.now;
  const waiting = data.challenges.filter((c) => c.state === 1 && now <= c.matchEndsAt);
  const lastAnswer = Math.max(0, ...waiting.map((c) => c.matchEndsAt));
  const full = isFull(info);
  // a cancelled event or a missed deadline: what guests have not taken back yet
  const refunding = phase === "Cancelled" || phase === "Past the deadline";
  const owed = data.booked.length;
  const deposited = record.data
    ? [...record.data.wallets.values()].filter((w) => w.deposit).length
    : data.guests.length;
  const lead = phase === "Cancelled" ? "" : "The deadline to confirm who came has passed. ";
  // nothing to answer yet: say when to come back instead
  const step: NextStep = refunding
    ? owed > 0
      ? {
          title: NEXT_STEP[phase].title,
          detail: `${lead}${owed === 1 ? "1 guest has" : `${owed} guests have`} not withdrawn their deposit yet. They can withdraw it on the guest page, or you can send the refunds on the Payout tab.`,
          tab: "payout",
          action: "Open Payout",
        }
      : {
          title: NEXT_STEP[phase].title,
          detail: `${lead}${deposited > 0 ? "Every guest's deposit has been returned." : "No guest had deposited, so there is nothing to return."}`,
          tab: null,
          action: null,
          done: true,
        }
    : phase === "Deposits open" && full
      ? {
          title: "The event is full",
          detail:
            "Every spot has a deposit, so no one else can deposit. To make room, turn a guest away on the Guests tab before the event starts: they get their deposit back in full and cannot deposit again.",
          tab: "guests",
          action: "Open Guests",
        }
      : phase === "Live now" && full
        ? {
            title: "The event is full",
            detail:
              "Every spot has a deposit and the event has started, so walk-ins cannot deposit and no one can be turned away. Check guests in on Luma as they arrive: only checked-in guests count as attendees.",
            tab: "guests",
            action: "Open Guests",
          }
        : phase === "Challenges pending" && waiting.length > 0
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
              : phase === "Payouts released" && data.unpaid.length === 0 && data.refused.length === 0
                ? {
                    title: "All done",
                    detail: "Every attendee has been paid their share.",
                    tab: null,
                    action: null,
                    done: true,
                  }
                : phase === "Payouts released"
                  ? {
                      ...NEXT_STEP[phase],
                      detail: unpaidLede(
                        data.unpaid,
                        info.attendeeCount,
                        info.payoutShare,
                        (u) => assetText(u, info),
                        data.refused.length,
                      ),
                    }
                  : NEXT_STEP[phase];
  const booking = phase === "Deposits open" || phase === "Live now";
  const guestLink = `${typeof window === "undefined" ? "" : window.location.origin}${paths.event.getHref(address)}`;
  const deadline =
    phase === "Deposits open"
      ? `Starts ${when(info.eventStart)} · deposits stay open until it ends`
      : phase === "Live now"
        ? full
          ? "The event is under way · it is full, so walk-ins cannot deposit"
          : `The event is under way · walk-ins can deposit until ${when(info.eventEnd)}`
        : phase === "Attendance due" || phase === "List not closed"
          ? `Confirm who came by ${when(info.claimDeadline)}`
          : phase === "Challenge window"
            ? `Challenges close ${when(info.challengeEndsAt)}`
            : phase === "Challenges pending" && waiting.length > 0
              ? `Answer by ${when(lastAnswer)}`
              : null;

  const cancelled = info.phase === 3;
  const canCancel = event.isOwner && event.onChain && info.phase === 0 && now <= info.claimDeadline;
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
              <span>On the day, check every guest in on Luma: only checked-in guests count as attendees.</span>
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
          refunding
            ? { label: "Deposits not yet withdrawn", value: <NumberPop value={String(info.stakerCount)} still /> }
            : { label: "Deposits", value: <NumberPop value={String(info.stakerCount)} still /> },
          ...(refunding && record.data ? [{ label: "Deposits made", value: String(deposited) }] : []),
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
            // a cancelled event has no deadline left to meet: it shows its cancellation instead
            {
              label: cancelled ? "Ends" : now >= info.eventEnd ? "Ended · deposits closed" : "Ends · deposits close",
              value: when(info.eventEnd),
            },
            cancelled
              ? {
                  label: "Cancelled",
                  value: record.data?.cancelled ? <TxLink tx={record.data.cancelled.tx} testId="cancel-tx" /> : "—",
                }
              : info.phase >= 1
                ? {
                    // the list was closed when the challenge window opened
                    label: "Attendance confirmed",
                    value: (
                      <>
                        {when(info.challengeEndsAt - info.challengePeriod)}
                        {record.data?.listClosed && (
                          <>
                            {" · "}
                            <TxLink tx={record.data.listClosed.tx} testId="overview-list-closed-tx" />
                          </>
                        )}
                      </>
                    ),
                  }
                : {
                    label:
                      phase === "Past the deadline" ? "Deadline to confirm who came (missed)" : "Confirm who came by",
                    value: when(info.claimDeadline),
                  },
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
