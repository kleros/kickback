"use client";

import { useEffect, useState } from "react";

import { BATCH_SIZE } from "@kickback/core";
import { zeroAddress } from "viem";
import { usePublicClient } from "wagmi";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { publishCase } from "@/lib/kleros/publishCase";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { caseUrl, resolverCaseUrl } from "@/config/protocol";

import { Messages } from "./Messages";
import { ConfirmDialog, Figures, TxLink } from "./parts";
import { useEventRecord } from "../hooks/useEventRecord";
import { useLumaBook } from "../hooks/useLumaBook";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { assetText, ethText, shortHex, TYPED_WORDS, when } from "../model/view";
import { tx } from "../operations/tx";

const RELEASED = "Payouts released. Attendees can now claim.";
const attendees = (n: number) => `${n} ${n === 1 ? "attendee" : "attendees"}`;

/** What is left to pay after the release, said for who is still unpaid. */
export function unpaidLede(unpaid: number, total: number, share: string) {
  if (unpaid === 0) return `Each attendee's share is ${share}. Every attendee has been paid.`;
  if (unpaid < total)
    return `${unpaid} of ${attendees(total)} ${unpaid === 1 ? "has" : "have"} not been paid yet. ${unpaid === 1 ? "They can claim" : "Each can claim"} ${share} on the guest page, or you can send ${unpaid === 1 ? "it to them" : "them their shares"} now (you pay the network fee). The Guests tab shows each payment.`;
  return `Each attendee can claim ${share} on the guest page. You can also send every attendee their share now (you pay the network fee).`;
}

/** "23 h 40 min left", from now to a deadline. */
const left = (from: number, to: number) => {
  const m = Math.max(0, Math.floor((to - from) / 60));
  return m >= 60 ? (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m / 60} h left`) : `${m} min left`;
};

export function PayoutScreen() {
  const event = useOrganiserEvent();
  const record = useEventRecord(event.address);
  const luma = useLumaBook(event.address, event.isOwner);
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const [confirm, setConfirm] = useState<"release" | null>(null);
  // where the last action's result is shown: the challenge row it came from (its lower-case wallet), or "tab"
  const [target, setTarget] = useState<string | null>(null);
  // the dialog belongs to the wallet that opened it: close it on Disconnect, an account or a network switch
  const accountKey = event.account?.toLowerCase();
  useEffect(() => {
    setConfirm(null);
    setTarget(null);
  }, [accountKey, event.onChain]);
  const data = event.overview.data;
  if (!data) return <p className="og-note">Loading the event…</p>;
  const info = data.event;
  const now = event.now ?? data.now;
  const act = (where: string, ...args: Parameters<typeof event.run>) => {
    setTarget(where);
    event.run(...args);
  };
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
  // a challenge still waiting for its answer always ends as one more share (added, sent to Kleros with a share
  // held, or accepted at release), and release waits for it: count it now
  const pending = info.phase === 1 ? stillOpen.length : 0;
  const shares = attendeesAfter + info.openCases + pending;
  const missed = info.phase === 0 && now > info.claimDeadline;
  const toSend = data.unpaid.slice(0, BATCH_SIZE);
  const share = info.phase === 2 ? info.payoutShare : shares ? pool / BigInt(shares) : 0n;
  // a share is more than the deposit only when someone did not come (or a lost case's share was split)
  const shareText =
    share > info.depositAmount
      ? "a full share like every attendee (their deposit plus part of the no-shows' deposits)"
      : "their deposit back";
  const me = event.account?.toLowerCase();
  const recOf = (wallet: string) => record.data?.wallets.get(wallet.toLowerCase());
  const refundBatch = data.booked.slice(0, BATCH_SIZE);
  const guests = (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`;

  return (
    <div className="flex flex-col gap-5" data-testid="payout">
      <h2 className="kb-h1">Payout</h2>
      {info.phase === 0 && !missed ? (
        <GlassCard className="og-card">
          <h3 className="og-h2">Confirm who came first</h3>
          <p className="og-lede">Payouts open once the list is closed and the challenge window is over.</p>
        </GlassCard>
      ) : info.phase === 0 || info.phase === 3 ? (
        <GlassCard className="og-card" data-testid="refunds">
          <h3 className="og-h2">{info.phase === 3 ? "The event was cancelled" : "The deadline has passed"}</h3>
          {info.phase === 3 && record.data?.cancelled && (
            <p className="og-note">
              Cancelled in transaction <TxLink tx={record.data.cancelled.tx} testId="cancel-tx" />.
            </p>
          )}
          <p className="og-lede">
            {info.phase === 3
              ? "Every guest gets their full deposit back. They can withdraw it on the guest page, or you can send the refunds now."
              : `Attendance was not confirmed by ${when(info.claimDeadline)}, so every guest gets their full deposit back. They can withdraw it on the guest page, or you can send the refunds now.`}
          </p>
          {data.booked.length === 0 ? (
            <p className="og-note" data-testid="refunds-owed">
              Every deposit has been refunded.
            </p>
          ) : (
            <>
              <p className="og-note" data-testid="refunds-owed">
                {`${guests(data.booked.length)} ${data.booked.length === 1 ? "has" : "have"} not withdrawn their deposit yet.`}
              </p>
              <ul className="og-note flex flex-col gap-1">
                {data.booked.map((w) => (
                  <li key={w} title={w}>
                    {luma.nameOf(w) ?? "—"} · <span className="og-mono">{shortHex(w)}</span>
                  </li>
                ))}
              </ul>
              <div className="og-actions">
                <GradientButton
                  isDisabled={!canActAsAnyone}
                  onPress={() => {
                    const batch = refundBatch;
                    act(
                      "tab",
                      "Refund",
                      () => tx.distribute(info.contract, batch),
                      `Refunds sent to ${guests(batch.length)}.`,
                    );
                  }}
                >
                  {data.booked.length > refundBatch.length
                    ? `Send refunds to the next ${guests(refundBatch.length)} (${data.booked.length} still owed)`
                    : `Send refunds to every guest (${refundBatch.length})`}
                </GradientButton>
                <span className="og-note">
                  You pay the network fee. A wallet that refuses the payment can still withdraw on the guest page.
                </span>
              </div>
            </>
          )}
          <Messages event={event} />
        </GlassCard>
      ) : (
        <>
          <Figures
            big
            rows={[
              { label: "All deposits", value: assetText(pool, info) },
              { label: "Attendees", value: String(attendeesAfter) },
              {
                label: "Each gets",
                value: assetText(share, info),
                note:
                  info.phase === 1
                    ? pending > 0
                      ? `Counts ${pending} open ${pending === 1 ? "challenge" : "challenges"}; can change until payouts are released`
                      : "Can change until payouts are released"
                    : undefined,
              },
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
                // a ruling the contract does not know (above 2) cannot be settled: it reverts
                const ruled = c.state === 2 && c.isRuled === true && (c.ruling ?? 99) <= 2;
                const canSettle = ruled && info.phase !== 0;
                const waitingRuling = c.state === 2 && !c.isRuled;
                // what is left of the two fees after the Kleros cost, and who paid the matching fee
                const leftOver = 2n * c.deposit - c.arbitrationPaid;
                const half = leftOver / 2n;
                const matcherIsMe = !!me && c.matcher.toLowerCase() === me;
                const who = matcherIsMe
                  ? "you"
                  : c.matcher.toLowerCase() === info.owner.toLowerCase()
                    ? "the organiser"
                    : shortHex(c.matcher);
                const appeal = c.state === 2 && !c.isRuled && c.appeal && c.appeal.end > 0 ? c.appeal : undefined;
                const appealRuling =
                  appeal?.ruling === 1
                    ? "Kleros jurors ruled this guest came."
                    : appeal?.ruling === 2
                      ? "Kleros jurors ruled this guest did not come."
                      : "Kleros jurors did not rule either way.";
                // the organiser's side is "did not come": the full window when it is winning, else the first part
                const ourDeadline = appeal ? (appeal.ruling === 2 ? appeal.end : appeal.loserEnd) : 0;
                const weCan = event.isOwner ? "You can" : "The organiser can";
                const appealText = !appeal
                  ? ""
                  : appeal.ruling === 2
                    ? now <= appeal.loserEnd
                      ? `${appealRuling} The guest can appeal on the case page until ${when(appeal.loserEnd)}. If they do, the ruling stands only if ${event.isOwner ? "you pay" : "the organiser pays"} ${ethText(appeal.costAbsent)} by ${when(appeal.end)}. After that the ruling becomes final and can be settled here.`
                      : now <= appeal.end
                        ? `${appealRuling} If the guest appealed, the ruling stands only if ${event.isOwner ? "you pay" : "the organiser pays"} ${ethText(appeal.costAbsent)} on the case page by ${when(appeal.end)}. After that the ruling becomes final and can be settled here.`
                        : `${appealRuling} The appeal time has ended. The ruling becomes final once Kleros records it; then it can be settled here.`
                    : now <= ourDeadline
                      ? `${appealRuling} ${weCan} appeal on the case page until ${when(ourDeadline)} by paying ${ethText(appeal.costAbsent)}; after that the ruling becomes final and can be settled here.`
                      : `${appealRuling} The appeal time has ended. The ruling becomes final once Kleros records it; then it can be settled here.`;
                const steps = recOf(c.wallet)?.challenge;
                const hasActions = !!href || canMatch || canSettle || waitingRuling;
                const name = luma.nameOf(c.wallet);
                const came = data.guests.find((g) => g.wallet.toLowerCase() === c.wallet.toLowerCase())?.attended;
                const status =
                  c.state === 1
                    ? now <= c.matchEndsAt
                      ? `${event.isOwner ? "Waiting for you" : "Waiting for the organiser"} · ${left(now, c.matchEndsAt)}`
                      : "Not answered in time: will be added at release"
                    : c.state === 2
                      ? ruled
                        ? c.ruling === 1
                          ? "Kleros ruled: they came · ready to settle"
                          : c.ruling === 2
                            ? "Kleros ruled: they did not come · ready to settle"
                            : "Kleros did not rule either way · ready to settle"
                        : appeal
                          ? now <= appeal.end
                            ? "Kleros ruled: appeal open"
                            : "Kleros ruled: waiting for the final ruling"
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
                              ? ruled
                                ? c.ruling === 1
                                  ? `Kleros jurors ruled this guest came. Settle the ruling: they join the list, get back ${ethText(leftOver)} (what is left of the two fees after the Kleros cost) and get ${shareText}.`
                                  : c.ruling === 2
                                    ? `Kleros jurors ruled this guest did not come. Settle the ruling: they stay off the list and ${who} ${matcherIsMe ? "get" : "gets"} back ${ethText(leftOver)}.`
                                    : `Kleros jurors did not rule either way. Settle the ruling: the guest stays off the list, and the ${ethText(leftOver)} left of the two fees is split in half: ${ethText(half)} to the guest and ${ethText(leftOver - half)} to ${who}.`
                                : appeal
                                  ? appealText
                                  : "Kleros jurors are deciding. Send your evidence (Luma check-in, photos) on the case page. Once they rule, settle it here."
                              : !wentToKleros
                                ? `${steps?.answer?.kind === "added" ? "This guest was added to the list." : steps?.answer?.kind === "unanswered" ? "This guest's challenge was not answered in time, so they were added to the list." : "This guest was added to the list."} Their Kleros fee was returned, and they get ${shareText}.`
                                : came
                                  ? `Kleros jurors ruled this guest came. They were added to the list, got back what was left of the two fees (${ethText(leftOver)}), and get ${shareText}.`
                                  : c.ruling === 0
                                    ? `Kleros jurors did not rule either way, so the guest stays off the list. What was left of the two fees (${ethText(leftOver)}) was split: ${ethText(half)} went to the guest and ${ethText(leftOver - half)} to ${who}.`
                                    : `Kleros jurors ruled this guest did not come, so they stay off the list. What was left of the two fees (${ethText(leftOver)}) went back to ${who}.`}
                    </p>
                    {steps && (
                      <p className="og-note flex flex-wrap gap-x-3" data-testid="challenge-txs">
                        <span>
                          Challenge <TxLink tx={steps.tx} />
                        </span>
                        {steps.answer && (
                          <span>
                            {steps.answer.kind === "kleros"
                              ? `Sent to Kleros (case ${steps.answer.caseId})`
                              : steps.answer.kind === "added"
                                ? "Added"
                                : "Accepted"}{" "}
                            <TxLink tx={steps.answer.tx} />
                          </span>
                        )}
                        {steps.resolved && (
                          <span>
                            Settled <TxLink tx={steps.resolved.tx} />
                          </span>
                        )}
                      </p>
                    )}
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
                                  act(
                                    c.wallet.toLowerCase(),
                                    "Add",
                                    () => tx.addAttendees(info.contract, [c.wallet]),
                                    `${name ?? shortHex(c.wallet)} added to the list.`,
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
                                act(
                                  c.wallet.toLowerCase(),
                                  "Send to Kleros",
                                  async () => {
                                    // the jurors must be able to read the case: pin its text before it opens
                                    await publishCase(client!, info.contract, c.wallet);
                                    return tx.matchChallenge(info.contract, c.wallet, c.deposit);
                                  },
                                  `Sent. ${name ? `${name}'s` : "The"} case is now with Kleros.`,
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
                              act(
                                c.wallet.toLowerCase(),
                                "Settle",
                                () => tx.resolveChallenge(info.contract, c.wallet),
                                `${name ? `${name}'s challenge` : "The challenge"} is settled.`,
                              )
                            }
                          >
                            Settle the ruling
                          </GradientButton>
                        )}
                      </div>
                    )}
                    {target === c.wallet.toLowerCase() && <Messages event={event} />}
                  </GlassCard>
                );
              })
            )}
          </section>
          {info.phase === 1 ? (
            <GlassCard className="og-card">
              <h3 className="og-h2">Release payouts</h3>
              <p className="og-lede">
                Splits all the deposits among the attendees. A share is held for each open Kleros case until it is
                decided. Anyone can release payouts once the challenge window is over.
              </p>
              <div className="og-actions">
                <GradientButton isDisabled={!!releaseReason || !canActAsAnyone} onPress={() => setConfirm("release")}>
                  Release payouts
                </GradientButton>
                {releaseReason && <span className="og-note">{releaseReason}</span>}
              </div>
              {target === "tab" && <Messages event={event} />}
            </GlassCard>
          ) : (
            <GlassCard className="og-card">
              <h3 className="og-h2">Payouts released</h3>
              {record.data?.released && (
                <p className="og-note" data-testid="release-tx">
                  Released in transaction <TxLink tx={record.data.released.tx} />. Releasing moves no money by itself:
                  each payment is its own transaction, listed per guest on the Guests tab and in its downloadable
                  record.
                </p>
              )}
              <p className="og-lede" data-testid="payout-lede">
                {unpaidLede(data.unpaid.length, info.attendeeCount, assetText(info.payoutShare, info))}
              </p>
              {data.unpaid.length > 0 ? (
                <div className="og-actions">
                  <GradientButton
                    isDisabled={!canActAsAnyone}
                    onPress={() => {
                      const batch = toSend;
                      act(
                        "tab",
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
              {target === "tab" && <Messages event={event.done === RELEASED ? { ...event, done: null } : event} />}
            </GlassCard>
          )}
        </>
      )}
      {confirm === "release" && info.phase === 1 && (
        <ConfirmDialog
          isOpen
          title="Release payouts"
          intro="This splits all the deposits among the attendees. It cannot be undone."
          words={[TYPED_WORDS.pay]}
          figures={[
            { label: "All deposits", value: assetText(pool, info) },
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
            act("tab", "Release", () => tx.releasePayouts(info.contract, expired), RELEASED);
          }}
        />
      )}
    </div>
  );
}
