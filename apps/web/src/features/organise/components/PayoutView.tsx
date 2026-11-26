"use client";

import { useState } from "react";

import { BATCH_SIZE } from "@kickback/core";
import { zeroAddress } from "viem";
import { usePublicClient } from "wagmi";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { publishCase } from "@/lib/kleros/publishCase";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { caseUrl, resolverCaseUrl } from "@/config/protocol";

import { Messages } from "./Messages";
import { ConfirmDialog, Figures } from "./parts";
import { useLumaBook } from "../hooks/useLumaBook";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { assetText, ethText, shortHex, TYPED_WORDS, when } from "../model/view";
import { tx } from "../operations/tx";

const RELEASED = "Payouts released. Attendees can now claim.";
const attendees = (n: number) => `${n} ${n === 1 ? "attendee" : "attendees"}`;

/** "23 h 40 min left", from now to a deadline. */
const left = (from: number, to: number) => {
  const m = Math.max(0, Math.floor((to - from) / 60));
  return m >= 60 ? (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m / 60} h left`) : `${m} min left`;
};

export function PayoutScreen() {
  const event = useOrganiserEvent();
  const luma = useLumaBook(event.address, event.isOwner);
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const [confirm, setConfirm] = useState<"release" | null>(null);
  const data = event.overview.data;
  if (!data) return <p className="og-note">Loading the event…</p>;
  const info = data.event;
  const now = data.now;
  const canSend = event.isOwner && event.onChain && !event.busy;
  // anyone may send a case to Kleros, release, settle or send payouts (the contract does not limit them)
  const canActAsAnyone = event.connected && event.onChain && !event.busy;
  const expired = data.challenges.filter((c) => c.state === 1 && now > c.matchEndsAt).map((c) => c.wallet);
  const stillOpen = data.challenges.filter((c) => c.state === 1 && now <= c.matchEndsAt);
  const disputed = data.challenges.filter((c) => c.state === 2);
  const releaseReason =
    info.phase !== 1
      ? null
      : now <= info.challengeEndsAt
        ? `The challenge window closes ${when(info.challengeEndsAt)}.`
        : stillOpen.length
          ? `${stillOpen.length} ${stillOpen.length === 1 ? "challenge is" : "challenges are"} ${event.isOwner ? "still waiting for your answer." : "still waiting for the organiser's answer."}`
          : null;
  const pool = info.depositAmount * BigInt(info.stakerCount);
  // releasing first accepts every unanswered challenge whose answer window is over
  const attendeesAfter = info.attendeeCount + (info.phase === 1 ? expired.length : 0);
  const shares = attendeesAfter + info.openCases;
  const missed = info.phase === 0 && now > info.claimDeadline;
  const toSend = data.unpaid.slice(0, BATCH_SIZE);
  const share = info.phase === 2 ? info.payoutShare : shares ? pool / BigInt(shares) : 0n;

  return (
    <div className="flex flex-col gap-5" data-testid="payout">
      <h2 className="kb-h1">Payout</h2>
      {info.phase === 0 || info.phase === 3 ? (
        <GlassCard className="og-card">
          <h3 className="og-h2">
            {info.phase === 3
              ? "The event was cancelled"
              : missed
                ? "The deadline has passed"
                : "Confirm who came first"}
          </h3>
          <p className="og-lede">
            {info.phase === 3
              ? "Every guest can withdraw their full deposit on the guest page."
              : missed
                ? "Attendance was not confirmed in time, so every guest can withdraw their full deposit on the guest page."
                : "Payouts open once the list is closed and the challenge window is over."}
          </p>
        </GlassCard>
      ) : (
        <>
          <Figures
            big
            rows={[
              { label: "Pool", value: assetText(pool, info) },
              { label: "Attendees", value: String(attendeesAfter) },
              { label: "Each gets", value: assetText(share, info) },
              {
                label: "Challenges",
                value: String(data.challenges.length),
                // every open kind, not only the first: a waiting answer must not hide a Kleros case
                note:
                  [
                    stillOpen.length &&
                      `${stillOpen.length} ${event.isOwner ? "waiting for you" : "waiting for the organiser"}`,
                    disputed.length && `${disputed.length} with Kleros`,
                    info.phase === 1 && expired.length && `${expired.length} to be added`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined,
              },
            ]}
          />
          <section className="flex flex-col gap-3" data-testid="challenges">
            <h3 className="og-h2">Challenges</h3>
            {data.challenges.length === 0 ? (
              <p className="og-note">
                {info.phase === 1 && now <= info.challengeEndsAt
                  ? `No challenges yet. Guests left off can challenge until ${when(info.challengeEndsAt)}.`
                  : "No guest challenged the list."}
              </p>
            ) : (
              data.challenges.map((c) => {
                const wentToKleros = c.matcher.toLowerCase() !== zeroAddress;
                // evidence for a Dispute Resolver case is sent on its case page
                const href =
                  c.state === 2 || (c.state === 3 && wentToKleros)
                    ? (resolverCaseUrl(DEFAULT_CHAIN_ID, c.localDisputeID) ??
                      caseUrl(DEFAULT_CHAIN_ID, c.arbitratorDisputeID))
                    : undefined;
                const canMatch = c.state === 1 && now <= c.matchEndsAt && info.phase === 1;
                // addAttendees is refused once the challenge window is over, though a late challenge can still be
                // sent to Kleros until its own answer window ends
                const canAddThem = canMatch && now <= info.challengeEndsAt;
                const canSettle = c.state === 2 && info.phase !== 0 && c.isRuled === true;
                const waitingRuling = c.state === 2 && !c.isRuled;
                const hasActions = !!href || canMatch || canSettle || waitingRuling;
                const name = luma.nameOf(c.wallet);
                const came = data.guests.find((g) => g.wallet.toLowerCase() === c.wallet.toLowerCase())?.attended;
                const status =
                  c.state === 1
                    ? now <= c.matchEndsAt
                      ? `${event.isOwner ? "Waiting for you" : "Waiting for the organiser"} · ${left(now, c.matchEndsAt)}`
                      : "Not answered in time: will be added at release"
                    : c.state === 2
                      ? c.isRuled
                        ? "Ruled by Kleros: ready to settle"
                        : "With Kleros"
                      : !wentToKleros
                        ? "Settled: added to the list"
                        : came
                          ? "Kleros ruled: they came"
                          : c.ruling === 0
                            ? "Settled: not added"
                            : "Kleros ruled: they did not come";
                return (
                  <GlassCard key={c.wallet} className="og-card" data-testid="challenge-row">
                    <div className="flex flex-col gap-1">
                      <span title={c.wallet}>
                        {name && <b className="mr-2">{name}</b>}
                        <span className="og-mono">{shortHex(c.wallet)}</span>
                      </span>
                      <span className="og-note">{status}</span>
                    </div>
                    <p className="og-lede">
                      {c.state === 1 && now <= c.matchEndsAt && now <= info.challengeEndsAt
                        ? `This guest says they came, and has paid ${ethText(c.deposit)} to challenge. If they did come, add them: they get the fee back. If they did not, send the case to Kleros by paying the same ${ethText(c.deposit)} from your wallet. Kleros jurors then decide, and whichever side wins gets back what is left of the two fees. If you do nothing by ${when(c.matchEndsAt)}, they will be added automatically when payouts are released.`
                        : c.state === 1 && now <= c.matchEndsAt
                          ? `This guest says they came, and has paid ${ethText(c.deposit)} to challenge. The time to add guests has passed. If they came, do nothing: they will be added when payouts are released after ${when(c.matchEndsAt)}. If they did not, send the case to Kleros by paying the same ${ethText(c.deposit)} from your wallet before then. Kleros jurors then decide, and whichever side wins gets back what is left of the two fees.`
                          : c.state === 1
                            ? `${event.isOwner ? "You" : "The organiser"} did not answer in time, so this guest will be added automatically when payouts are released.`
                            : c.state === 2
                              ? "Kleros jurors are deciding. Send your evidence (Luma check-in, photos) on the case page. Once they rule, settle it here."
                              : !wentToKleros
                                ? "This guest was added to the list. Their Kleros fee was returned, and they get their deposit back plus a share."
                                : came
                                  ? "Kleros jurors ruled this guest came. They were added to the list and get a share."
                                  : c.ruling === 0
                                    ? "Kleros jurors did not rule either way. The guest stays off the list."
                                    : "Kleros jurors ruled this guest did not come."}
                    </p>
                    {hasActions && (
                      <div className="og-actions">
                        {href && (
                          <a className="kb-btn is-quiet" href={href} target="_blank" rel="noreferrer">
                            Open the Kleros case
                          </a>
                        )}
                        {canMatch && (
                          <>
                            {canAddThem && (
                              <GradientButton
                                isDisabled={!canSend}
                                onPress={() =>
                                  event.run(
                                    "Add",
                                    () => tx.addAttendees(info.contract, [c.wallet]),
                                    `${shortHex(c.wallet)} added to the list.`,
                                  )
                                }
                              >
                                They came: add them
                              </GradientButton>
                            )}
                            <GradientButton
                              className="is-quiet"
                              isDisabled={!canActAsAnyone}
                              onPress={() =>
                                event.run(
                                  "Send to Kleros",
                                  async () => {
                                    // the jurors must be able to read the case: pin its text before it opens
                                    await publishCase(client!, info.contract, c.wallet);
                                    return tx.matchChallenge(info.contract, c.wallet, c.deposit);
                                  },
                                  "Sent. The case is now with Kleros.",
                                )
                              }
                            >
                              {`Send to Kleros · ${ethText(c.deposit)}`}
                            </GradientButton>
                          </>
                        )}
                        {waitingRuling && <span className="og-note">Kleros has not ruled yet.</span>}
                        {canSettle && (
                          <GradientButton
                            className="is-quiet"
                            isDisabled={!canActAsAnyone}
                            onPress={() =>
                              event.run(
                                "Settle",
                                () => tx.resolveChallenge(info.contract, c.wallet),
                                "Challenge settled.",
                              )
                            }
                          >
                            Settle the ruling
                          </GradientButton>
                        )}
                      </div>
                    )}
                  </GlassCard>
                );
              })
            )}
          </section>
          <Messages event={info.phase !== 1 && event.done === RELEASED ? { ...event, done: null } : event} />
          {info.phase === 1 ? (
            <GlassCard className="og-card">
              <h3 className="og-h2">Release payouts</h3>
              <p className="og-lede">
                Splits the pool among the attendees. A share is held for each open Kleros case until it is decided.
                Anyone can release payouts once the challenge window is over.
              </p>
              <div className="og-actions">
                <GradientButton isDisabled={!!releaseReason || !canActAsAnyone} onPress={() => setConfirm("release")}>
                  Release payouts
                </GradientButton>
                {releaseReason && <span className="og-note">{releaseReason}</span>}
              </div>
            </GlassCard>
          ) : (
            <GlassCard className="og-card">
              <h3 className="og-h2">Payouts released</h3>
              <p className="og-lede">
                {data.unpaid.length > 0
                  ? `Each attendee can claim ${assetText(info.payoutShare, info)} on the guest page. You can also send every attendee their share now (you pay the network fee).`
                  : `Each attendee's share is ${assetText(info.payoutShare, info)}.`}
              </p>
              {data.unpaid.length > 0 ? (
                <div className="og-actions">
                  <GradientButton
                    isDisabled={!canActAsAnyone}
                    onPress={() => {
                      const batch = toSend;
                      event.run(
                        "Send",
                        () => tx.distribute(info.contract, batch),
                        `Sent to ${attendees(batch.length)}.`,
                      );
                    }}
                  >
                    {data.unpaid.length > toSend.length
                      ? `Send to the next ${attendees(toSend.length)} (${data.unpaid.length} unpaid)`
                      : `Send to ${attendees(toSend.length)}`}
                  </GradientButton>
                  <span className="og-note">
                    A wallet that refuses the payment can still claim it on the guest page.
                  </span>
                </div>
              ) : (
                <p className="og-note">
                  Nothing is left to send. A wallet that refused the payment can still claim it on the guest page.
                  {info.openCases > 0 && " A share is held for each open Kleros case until it is decided."}
                </p>
              )}
            </GlassCard>
          )}
        </>
      )}
      {confirm === "release" && (
        <ConfirmDialog
          isOpen
          title="Release payouts"
          intro="This splits the pool. It cannot be undone."
          words={[TYPED_WORDS.pay]}
          figures={[
            { label: "Pool", value: assetText(pool, info) },
            { label: "Attendees", value: String(attendeesAfter) },
            { label: "Added from unanswered challenges", value: String(expired.length) },
            { label: "Each gets", value: assetText(share, info) },
          ]}
          action="Release payouts"
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            event.run("Release", () => tx.releasePayouts(info.contract, expired), RELEASED);
          }}
        />
      )}
    </div>
  );
}
