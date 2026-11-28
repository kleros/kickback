"use client";

import { useEffect, useState } from "react";

import { BATCH_SIZE } from "@kickback/core";
import { getAddress, zeroAddress } from "viem";
import { usePublicClient } from "wagmi";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { publishCase } from "@/lib/kleros/publishCase";
import { executeRulingRequest } from "@/lib/kleros/ruling";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { canRecordRuling, caseUrl, resolverCaseUrl } from "@/config/protocol";

import { Messages } from "./Messages";
import { Addr, ConfirmDialog, Figures, TxLink } from "./parts";
import { useEventRecord } from "../hooks/useEventRecord";
import { useLumaBook } from "../hooks/useLumaBook";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { projectedShare, unpaidLede } from "../model/payout";
import { heldSplitCount, type Payment } from "../model/record";
import { assetText, ethText, shortHex, TYPED_WORDS, when } from "../model/view";
import { tx } from "../operations/tx";

const RELEASED = "Payouts released. Attendees can now claim.";
const attendees = (n: number) => `${n} ${n === 1 ? "attendee" : "attendees"}`;

/** "23 h 40 min left", from now to a deadline. */
const left = (from: number, to: number) => {
  const m = Math.max(0, Math.floor((to - from) / 60));
  return m >= 60 ? (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m / 60} h left`) : `${m} min left`;
};

/** Note parts joined with "; ", the first one capitalised; undefined when there are none. */
const noteText = (parts: readonly (string | false | 0 | undefined | null)[]) => {
  const n = parts.filter(Boolean).join("; ");
  return n ? n[0]!.toUpperCase() + n.slice(1) : undefined;
};

export function PayoutScreen() {
  const event = useOrganiserEvent();
  const record = useEventRecord(event.address);
  const luma = useLumaBook(event.address, event.isOwner ? event.account : undefined, event.isOwner);
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
  // releasing first accepts every unanswered challenge whose answer window is over
  const attendeesAfter = info.attendeeCount + (info.phase === 1 ? expired.length : 0);
  // a challenge still waiting for its answer always ends as one more share (added, sent to Kleros with a share
  // held, or accepted at release), and release waits for it: count it now (the same figure as the Attendance tab)
  const pending = info.phase === 1 ? stillOpen.length : 0;
  const projected = projectedShare(info, data.challenges);
  const pool = projected.pool;
  const shares = projected.shares;
  const missed = info.phase === 0 && now > info.claimDeadline;
  const toSend = data.unpaid.slice(0, BATCH_SIZE).map((u) => u.wallet);
  const share = projected.share ?? 0n;
  // a case Kleros has ruled on still holds its share until someone settles it (a ruling above 2 cannot be settled)
  const ruledCases = disputed.filter((c) => c.isRuled === true && (c.ruling ?? 99) <= 2);
  const ruledCount = Math.min(ruledCases.length, info.openCases);
  const deciding = info.openCases - ruledCount;
  const counting = pending + deciding;
  // a ruling other than "came" (1) splits the held share among the attendees once it is settled
  const ruledWho = (r: number | undefined) => (r === 1 ? "it goes to the guest" : "it is split among the attendees");
  // before the release nothing is held yet: a share is set aside only for a case still open when payouts are released
  const beforeRelease = info.phase === 1;
  const heldNote =
    info.openCases > 0
      ? [
          deciding > 0 &&
            (beforeRelease
              ? `${deciding === 1 ? `a share will be held for ${info.openCases === 1 ? "the open Kleros case" : "the case still with Kleros"} if it is still open when payouts are released (it goes` : `${deciding} shares will be held for the ${deciding} cases still with Kleros if they are still open when payouts are released (each goes`} to the guest if they win, or is split among the attendees if they lose)`
              : `${deciding === 1 ? `a share is held for ${info.openCases === 1 ? "the open Kleros case" : "the case still with Kleros"} (it goes` : `${deciding} shares are held for the ${deciding} cases still with Kleros (each goes`} to the guest if they win, or is split among the attendees if they lose)`),
          ruledCount > 0 &&
            (beforeRelease
              ? ruledCount === 1
                ? `1 ruled case still counts in the split until it is settled (then ${ruledWho(ruledCases[0]?.ruling)}); settle it before releasing, or a share will be held for it`
                : `the ${ruledCount} ruled cases still count in the split until they are settled; settle them before releasing, or a share will be held for each`
              : ruledCount === 1
                ? `a share is held for 1 ruled case until it is settled (then ${ruledWho(ruledCases[0]?.ruling)})`
                : `a share is held for each of the ${ruledCount} ruled cases until it is settled`),
        ]
          .filter(Boolean)
          .join("; ") + (deciding > 0 ? ", so this can still rise" : "")
      : undefined;
  const fmt = (units: bigint) => assetText(units, info);
  const releasedBy = record.data?.released?.by;
  const releasedByName = releasedBy ? luma.nameOf(releasedBy) : undefined;
  const isGuestWallet = (w: string) => data.guests.some((g) => g.wallet.toLowerCase() === w.toLowerCase());
  const anyRefunded = data.guests.some((g) => g.status === 3);
  const allBack = data.booked.length === 0;
  // a share is more than the deposit only when someone did not come (or a lost case's share was split)
  const shareText =
    share > info.depositAmount
      ? "a full share like every attendee (their deposit plus part of the no-shows' deposits)"
      : "their deposit back";
  const me = event.account?.toLowerCase();
  const recOf = (wallet: string) => record.data?.wallets.get(wallet.toLowerCase());
  const refundBatch = data.booked.slice(0, BATCH_SIZE);
  const guests = (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`;
  // the refunds of a cancelled or missed event, oldest first (turn-away refunds belong to the Guests tab)
  const refunds = record.data
    ? [...record.data.wallets.entries()]
        .filter(([, r]) => !r.rejected)
        .flatMap(([key, r]) =>
          r.payments.filter((p) => p.kind === "refund").map((p) => ({ wallet: getAddress(key), p })),
        )
        .sort((a, b) => Number(a.p.block - b.p.block))
    : [];
  // the event can be handed to another organiser: each action is credited to the organiser at its time
  const handed = (record.data?.handovers.length ?? 0) > 0;
  const isOrganiserThen = (w: string, then: string | undefined) =>
    w.toLowerCase() === (then ?? info.owner).toLowerCase();
  const organiserWord = (w: string) =>
    !handed || w.toLowerCase() === info.owner.toLowerCase()
      ? "the organiser"
      : `the organiser at the time (${shortHex(w)})`;
  const refundVia = (p: Payment) =>
    p.via === "claimed"
      ? "withdrawn by the guest"
      : p.via === "sent" && p.sender
        ? p.sender.toLowerCase() === me
          ? "sent by you"
          : isOrganiserThen(p.sender, p.organiserThen)
            ? `sent by ${organiserWord(p.sender)}`
            : `sent by ${shortHex(p.sender)}`
        : p.via === "sent"
          ? "sent"
          : undefined;

  return (
    <div className="flex flex-col gap-5" data-testid="payout">
      <h2 className="kb-h1">Payout</h2>
      {/* after a wallet switch away and back the row a send came from is forgotten: still say it is confirming */}
      {target === null && event.pending && (
        <p className="og-note" role="status" data-testid="pending">
          {event.pending.text}
        </p>
      )}
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
          <p className="og-lede" data-testid="refunds-lede">
            {info.phase === 3
              ? allBack
                ? anyRefunded
                  ? "Every guest's deposit has been returned."
                  : "No guest has a deposit to get back."
                : `Every guest gets their full deposit back. They can withdraw it on the guest page, or you can send ${data.booked.length === 1 ? "the refund" : "the refunds"} now.`
              : allBack
                ? anyRefunded
                  ? `Attendance was not confirmed by ${when(info.claimDeadline)}, so every deposit has been returned.`
                  : `Attendance was not confirmed by ${when(info.claimDeadline)}. No guest has a deposit to get back.`
                : `Attendance was not confirmed by ${when(info.claimDeadline)}, so every guest gets their full deposit back. They can withdraw it on the guest page, or you can send ${data.booked.length === 1 ? "the refund" : "the refunds"} now.`}
          </p>
          {data.refundRefused.length > 0 && (
            <div className="flex flex-col gap-1" data-testid="refunds-refused">
              <p className="og-note">
                {data.refundRefused.length === 1
                  ? "One guest's wallet refused its refund. It can still be withdrawn on the guest page."
                  : `${data.refundRefused.length} guests' wallets refused their refunds. These can still be withdrawn on the guest page.`}
              </p>
              <ul className="og-note flex flex-col gap-1">
                {data.refundRefused.map((w) => (
                  <li key={w} title={w}>
                    {luma.nameOf(w) ?? "—"} · <span className="og-mono">{shortHex(w)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {anyRefunded && (
            <section className="flex flex-col gap-2" data-testid="refunds-list">
              <h4 className="og-h2">Refunds</h4>
              {record.isError && !record.data ? (
                <p className="og-err" role="alert">
                  The refund transactions could not be read. Reload the page to try again.
                </p>
              ) : !record.data ? (
                <p className="og-note" aria-live="polite">
                  Loading the record…
                </p>
              ) : refunds.length === 0 ? (
                <p className="og-note">No refund transaction found yet.</p>
              ) : (
                <ul className="og-note flex flex-col gap-1">
                  {refunds.map(({ wallet, p }) => (
                    <li key={`${p.tx}-${wallet}`} title={wallet} data-testid="refund-row">
                      {luma.nameOf(wallet) ?? "—"} · <span className="og-mono">{shortHex(wallet)}</span> ·{" "}
                      {fmt(p.amount)}
                      {refundVia(p) ? ` · ${refundVia(p)}` : ""} · <TxLink tx={p.tx} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="og-note">
                Each refund is also listed per guest on the Guests tab and in its downloadable record.
              </p>
            </section>
          )}
          {allBack ? null : (
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
                      batch.length === 1 ? "Refund sent to 1 guest." : `Refunds sent to ${guests(batch.length)}.`,
                    );
                  }}
                >
                  {data.booked.length > refundBatch.length
                    ? `Send refunds to the next ${guests(refundBatch.length)} (${data.booked.length} still owed)`
                    : refundBatch.length === 1
                      ? "Send the refund (1 guest)"
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
              {
                label: "Attendees",
                value: String(attendeesAfter),
                note:
                  info.phase === 1 && (counting > 0 || ruledCount > 0)
                    ? [
                        counting > 0 &&
                          `plus ${counting} ${counting === 1 ? "challenging guest" : "challenging guests"} counted in the split`,
                        ruledCount > 0 &&
                          `${counting > 0 ? "and " : "plus "}${ruledCount} ${ruledCount === 1 ? "ruling" : "rulings"} waiting to be settled${counting > 0 ? "" : ", counted in the split"}`,
                      ]
                        .filter(Boolean)
                        .join(" ")
                    : undefined,
              },
              {
                label: "Each gets",
                value: assetText(share, info),
                note: noteText([
                  info.phase === 1 && shares !== attendeesAfter && `split ${shares} ways`,
                  heldNote,
                  info.phase === 1 && info.openCases === 0 && "can change until payouts are released",
                ]),
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
                const tooLateText = event.isOwner
                  ? "Your time to answer this challenge ended, so this guest will be added when payouts are released. Nothing was sent."
                  : "The organiser's time to answer this challenge ended, so this guest will be added when payouts are released. Nothing was sent.";
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
                const matchedThen = recOf(c.wallet)?.challenge?.answer?.organiserThen;
                const who = matcherIsMe
                  ? "you"
                  : isOrganiserThen(c.matcher, matchedThen)
                    ? organiserWord(c.matcher)
                    : shortHex(c.matcher);
                // the organiser when this guest challenged (the one who had to answer)
                const answerer = c.organiser && c.organiser.toLowerCase() !== zeroAddress ? c.organiser : info.owner;
                const appeal =
                  c.state === 2 && !c.isRuled && c.appeal && (c.appeal.end > 0 || c.appeal.final)
                    ? c.appeal
                    : undefined;
                // the jurors' ruling is final but not recorded on Kleros yet: anyone can record it
                const final = !!appeal?.final;
                const canRecord = final && canRecordRuling(DEFAULT_CHAIN_ID, info.arbitrator);
                const waitingFirstRuling = waitingRuling && !appeal;
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
                  : final
                    ? `${appealRuling} The ruling is final but not yet recorded on Kleros. ${canRecord ? "Record it, then settle it here." : "Once Kleros records it, settle it here."}`
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
                const hasActions = !!href || canMatch || canSettle || waitingFirstRuling || canRecord;
                // a lost case after the release: its held share was split among the attendees (and the cases still open)
                const split = steps?.heldSplit;
                const splitText = split
                  ? ` The share held for them (${fmt(split.each * (split.attendees + split.openCases))}) was then split among the ${attendees(Number(split.attendees))}${split.openCases > 0n ? ` and the ${Number(split.openCases)} ${split.openCases === 1n ? "case" : "cases"} still with Kleros` : ""}: ${fmt(split.each)} each.`
                  : "";
                // settling a lost case after the release splits its held share: say so before it is sent (the
                // contract takes this case out of openCases first, then splits)
                const restOpen = Math.max(info.openCases - 1, 0);
                const splitWays = info.attendeeCount + restOpen;
                const willSplitText =
                  info.phase === 2 && ruled && c.ruling !== 1 && splitWays > 0
                    ? ` The share held for them (${fmt(info.payoutShare)}) is then split among the ${attendees(info.attendeeCount)}${restOpen > 0 ? ` and the ${restOpen} ${restOpen === 1 ? "case" : "cases"} still with Kleros` : ""}: ${fmt(info.payoutShare / BigInt(splitWays))} each.`
                    : "";
                const name = luma.nameOf(c.wallet);
                // what a settled challenger who joined the list gets: future before the release, then by what is paid
                const paidSoFar = data.sharePaid.get(c.wallet.toLowerCase()) ?? 0n;
                const shareClause =
                  info.phase !== 2
                    ? `will get ${shareText}`
                    : paidSoFar >= info.payoutShare
                      ? share > info.depositAmount
                        ? "were paid a full share like every attendee (their deposit plus part of the no-shows' deposits)"
                        : "got their deposit back"
                      : paidSoFar > 0n
                        ? "were paid part of their share and can claim the rest"
                        : `can claim ${shareText}`;
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
                          ? final
                            ? "Kleros ruled, not yet recorded"
                            : now <= appeal.end
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
                            ? `${me && answerer.toLowerCase() === me ? "You" : answerer.toLowerCase() === info.owner.toLowerCase() ? "The organiser" : `The organiser at the time (${shortHex(answerer)})`} did not answer in time, so this guest will be added automatically when payouts are released.`
                            : c.state === 2
                              ? ruled
                                ? c.ruling === 1
                                  ? `Kleros jurors ruled this guest came. Settle the ruling: they join the list, get back ${ethText(leftOver)} (what is left of the two fees after the Kleros cost) and get ${shareText}.`
                                  : c.ruling === 2
                                    ? `Kleros jurors ruled this guest did not come. Settle the ruling: they stay off the list and ${who} ${matcherIsMe ? "get" : "gets"} back ${ethText(leftOver)}.${willSplitText}`
                                    : `Kleros jurors did not rule either way. Settle the ruling: the guest stays off the list, and the ${ethText(leftOver)} left of the two fees is split in half: ${ethText(half)} to the guest and ${ethText(leftOver - half)} to ${who}.${willSplitText}`
                                : appeal
                                  ? appealText
                                  : "Kleros jurors are deciding. Send your evidence (Luma check-in, photos) on the case page. Once they rule, settle it here."
                              : !wentToKleros
                                ? `${steps?.answer?.kind === "added" ? "This guest was added to the list." : steps?.answer?.kind === "unanswered" ? "This guest's challenge was not answered in time, so they were added to the list." : "This guest was added to the list."} Their Kleros fee was returned, and they ${shareClause}.`
                                : came
                                  ? `Kleros jurors ruled this guest came. They were added to the list, got back what was left of the two fees (${ethText(leftOver)}), and ${shareClause}.`
                                  : c.ruling === 0
                                    ? `Kleros jurors did not rule either way, so the guest stays off the list. What was left of the two fees (${ethText(leftOver)}) was split: ${ethText(half)} went to the guest and ${ethText(leftOver - half)} to ${who}.${splitText}`
                                    : `Kleros jurors ruled this guest did not come, so they stay off the list. What was left of the two fees (${ethText(leftOver)}) went back to ${who}.${splitText}`}
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
                        {steps.heldSplit && (
                          <span>
                            Share split <TxLink tx={steps.heldSplit.tx} />
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
                                    undefined,
                                    {
                                      DuplicateAttendee: `${name ?? shortHex(c.wallet)} is already on the attendance list. Nothing was sent.`,
                                    },
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
                                    // the answer time may have ended since the page was read: say so before any upload
                                    const block = await client!.getBlock();
                                    if (block.timestamp > BigInt(c.matchEndsAt)) throw new Error(tooLateText);
                                    // the jurors must be able to read the case: pin its text before it opens
                                    await publishCase(client!, info.contract, c.wallet);
                                    return tx.matchChallenge(info.contract, c.wallet, c.deposit);
                                  },
                                  `Sent. ${name ? `${name}'s` : "The"} case is now with Kleros.`,
                                  undefined,
                                  {
                                    TooLate: tooLateText,
                                    WrongChallengeState: "This challenge was already answered. Nothing was sent.",
                                  },
                                )
                              }
                            >
                              {`Send to Kleros · ${ethText(c.deposit)}`}
                            </GradientButton>
                          </>
                        )}
                        {waitingFirstRuling && <span className="og-note">Kleros has not ruled yet.</span>}
                        {canRecord && (
                          <GradientButton
                            className="is-quiet"
                            isDisabled={!canActAsAnyone}
                            onPress={() =>
                              act(
                                c.wallet.toLowerCase(),
                                "Record the ruling",
                                () => executeRulingRequest(client!, info.contract, c.wallet),
                                "The ruling is recorded on Kleros. It can now be settled.",
                              )
                            }
                          >
                            Record the ruling
                          </GradientButton>
                        )}
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
                    {target === c.wallet.toLowerCase() && (
                      // once the row can no longer be answered, "try again" advice is gone with its button
                      <Messages
                        event={
                          c.state === 1 && !canMatch && event.error && /try again/i.test(event.error.text)
                            ? { ...event, error: null }
                            : event
                        }
                      />
                    )}
                  </GlassCard>
                );
              })
            )}
          </section>
          {info.phase === 1 ? (
            <GlassCard className="og-card">
              <h3 className="og-h2">Release payouts</h3>
              <p className="og-lede">
                Splits all the deposits among the attendees. A share is held for each Kleros case until it is decided or
                settled.
                {ruledCount > 0 ? " Settle ruled cases first so their result counts in the split." : ""} Anyone can
                release payouts once the challenge window is over.
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
                  Released
                  {releasedBy ? (
                    <>
                      {" by "}
                      {isOrganiserThen(releasedBy, record.data.released.organiserThen) ? (
                        organiserWord(releasedBy)
                      ) : isGuestWallet(releasedBy) ? (
                        <>
                          the guest{" "}
                          {releasedByName ? (
                            <>
                              {releasedByName} (<Addr address={releasedBy} />)
                            </>
                          ) : (
                            <Addr address={releasedBy} />
                          )}
                        </>
                      ) : (
                        <Addr address={releasedBy} />
                      )}
                    </>
                  ) : null}{" "}
                  in transaction <TxLink tx={record.data.released.tx} />. Releasing moves no money by itself: each
                  payment is its own transaction, listed per guest on the Guests tab and in its downloadable record.
                </p>
              )}
              <p className="og-lede" data-testid="payout-lede">
                {unpaidLede(
                  data.unpaid,
                  info.attendeeCount,
                  info.payoutShare,
                  fmt,
                  data.refused.length,
                  info.openCases,
                  heldSplitCount(record.data),
                )}
              </p>
              {data.unpaid.length > 0 ? (
                <>
                  {/* who the send pays: the wallet is what the transaction pays, the name (if loaded) who that is */}
                  <ul className="og-note flex flex-col gap-1" data-testid="unpaid-list">
                    {data.unpaid.map((u) => (
                      <li key={u.wallet} title={u.wallet}>
                        {luma.nameOf(u.wallet) ?? "—"} · <span className="og-mono">{shortHex(u.wallet)}</span> ·{" "}
                        {fmt(u.owed)}
                        {u.partlyPaid ? " (the rest of their share)" : ""}
                      </li>
                    ))}
                  </ul>
                  {data.unpaid.length > toSend.length && (
                    <p className="og-note">{`One transaction pays the first ${toSend.length} listed; send again for the rest.`}</p>
                  )}
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
                </>
              ) : (
                <p className="og-note" data-testid="nothing-left">
                  Nothing is left to send.
                  {data.refused.length > 0 &&
                    (data.refused.length === 1
                      ? " One attendee's wallet refused its payment. It can still be claimed on the guest page."
                      : ` ${data.refused.length} attendees' wallets refused their payments. These can still be claimed on the guest page.`)}
                  {info.openCases > 0 && " A share is held for each Kleros case until it is decided or settled."}
                </p>
              )}
              {target === "tab" && (
                <Messages event={event.done === RELEASED ? { ...event, done: null, doneTx: null } : event} />
              )}
            </GlassCard>
          )}
        </>
      )}
      {confirm === "release" && info.phase === 1 && (
        <ConfirmDialog
          isOpen
          title="Release payouts"
          intro={
            info.openCases === 1
              ? ruledCount === 1
                ? `This splits the deposits among the attendees and holds one share for the Kleros case that has been ruled but not settled yet. Once it is settled, ${ruledWho(ruledCases[0]?.ruling)}. It cannot be undone.`
                : "This splits the deposits among the attendees and holds one share for the open Kleros case. If the guest wins, they join the attendees and get that share; if they lose, it is split among the attendees. It cannot be undone."
              : info.openCases > 1
                ? `This splits the deposits among the attendees and holds one share for each of the ${info.openCases} Kleros cases${ruledCount > 0 ? ` (${ruledCount} ruled, waiting to be settled)` : ""}. If a guest wins their case, they join the attendees and get that share; if they lose, it is split among the attendees. It cannot be undone.`
                : "This splits all the deposits among the attendees. It cannot be undone."
          }
          words={[TYPED_WORDS.pay]}
          figures={[
            { label: "All deposits", value: assetText(pool, info) },
            { label: "Attendees", value: String(attendeesAfter) },
            { label: "Added from unanswered challenges", value: String(expired.length) },
            ...(info.openCases > 0
              ? [
                  {
                    label: info.openCases === 1 ? "Held for the open Kleros case" : "Held for open Kleros cases",
                    value:
                      info.openCases === 1
                        ? `1 (${assetText(share, info)})`
                        : `${info.openCases} (${assetText(share, info)} each)`,
                  },
                ]
              : []),
            { label: "Each gets", value: assetText(share, info) },
          ]}
          action="Release payouts"
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            act("tab", "Release", () => tx.releasePayouts(info.contract, expired), RELEASED, undefined, {
              // another wallet (or this one, from another tab) released first: the list is no longer "closed"
              NotListed:
                "Payouts were already released a moment ago, so nothing was sent. The page now shows who released them.",
            });
          }}
        />
      )}
    </div>
  );
}
