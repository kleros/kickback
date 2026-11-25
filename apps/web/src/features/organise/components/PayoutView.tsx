"use client";

import { useState } from "react";

import { batches, BATCH_SIZE } from "@kickback/core";
import { usePublicClient } from "wagmi";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { isShowableTime } from "@/utils/time";

import { publishCase } from "@/lib/kleros/publishCase";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { caseUrl } from "@/config/protocol";

import { Messages } from "./Messages";
import { ConfirmDialog, Figures } from "./parts";
import { useLumaBook } from "../hooks/useLumaBook";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { assetText, ethText, shortHex, TYPED_WORDS } from "../model/view";
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
      }).format(new Date(unix * 1000))
    : "date out of range";

/** "23 h 40 min left", from now to a deadline. */
const left = (from: number, to: number) => {
  const m = Math.max(0, Math.floor((to - from) / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`;
};

export function PayoutScreen() {
  const event = useOrganiserEvent();
  const luma = useLumaBook(event.address);
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const [confirm, setConfirm] = useState<"release" | null>(null);
  const data = event.overview.data;
  if (!data) return <p className="og-note">Reading the event…</p>;
  const info = data.event;
  const now = data.now;
  const canSend = event.isOwner && !event.busy;
  // anyone may answer a challenge (the contract does not limit match to the organiser)
  const canMatchAsAnyone = event.connected && !event.busy;
  const expired = data.challenges.filter((c) => c.state === 1 && now > c.matchEndsAt).map((c) => c.wallet);
  const stillOpen = data.challenges.filter((c) => c.state === 1 && now <= c.matchEndsAt);
  const disputed = data.challenges.filter((c) => c.state === 2);
  const releaseReason =
    info.phase !== 1
      ? null
      : now <= info.challengeEndsAt
        ? `The challenge window closes ${when(info.challengeEndsAt)}.`
        : stillOpen.length
          ? `${stillOpen.length} challenge still waiting for your answer.`
          : null;
  const pool = info.depositAmount * BigInt(info.stakerCount);
  const shares = info.attendeeCount + info.openCases;
  const share = info.phase === 2 ? info.payoutShare : shares ? pool / BigInt(shares) : 0n;

  return (
    <div className="flex flex-col gap-5" data-testid="payout">
      <h2 className="kb-h1">Challenges and payout</h2>
      {info.phase === 0 || info.phase === 3 ? (
        <GlassCard className="og-card">
          <h3 className="og-h2">{info.phase === 3 ? "The event was cancelled" : "Post the attendance list first"}</h3>
          <p className="og-lede">
            {info.phase === 3
              ? "Every booked guest withdraws their full deposit on the event page."
              : "Payouts open once the list is closed and the challenge window is over."}
          </p>
        </GlassCard>
      ) : (
        <>
          <Figures
            big
            rows={[
              { label: "Pool", value: assetText(pool, info) },
              { label: "Attendees", value: String(info.attendeeCount) },
              { label: info.phase === 2 ? "Each got" : "Each gets", value: assetText(share, info) },
              {
                label: "Challenges",
                value: stillOpen.length
                  ? `${stillOpen.length} waiting for you`
                  : disputed.length
                    ? `${disputed.length} with Kleros`
                    : String(data.challenges.length),
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
                const href = c.state === 2 ? caseUrl(DEFAULT_CHAIN_ID, c.arbitratorDisputeID) : undefined;
                const canMatch = c.state === 1 && now <= c.matchEndsAt && info.phase === 1;
                const name = luma.nameOf(c.wallet);
                const came = data.guests.find((g) => g.wallet.toLowerCase() === c.wallet.toLowerCase())?.attended;
                const status =
                  c.state === 1
                    ? now <= c.matchEndsAt
                      ? `Waiting for you · ${left(now, c.matchEndsAt)}`
                      : "Not answered in time: accepted"
                    : c.state === 2
                      ? "With Kleros"
                      : came
                        ? "Decided: they came"
                        : "Decided: they did not come";
                return (
                  <GlassCard key={c.wallet} className="og-card" data-testid="challenge-row">
                    <div className="og-head-row">
                      <span title={c.wallet}>
                        {name && <b className="mr-2">{name}</b>}
                        <span className="og-mono">{shortHex(c.wallet)}</span>
                      </span>
                      <span className="og-note">{status}</span>
                    </div>
                    <p className="og-lede">
                      {c.state === 1 && now <= c.matchEndsAt
                        ? `This guest says they came. They paid ${ethText(c.deposit)} to challenge. If they came: add them, and they get it back. If they did not: send it to Kleros, paying the same ${ethText(c.deposit)} from your wallet; jurors decide and the side they agree with gets its fee back. If you do nothing by ${when(c.matchEndsAt)}, they are added.`
                        : c.state === 1
                          ? "You did not answer in time, so this guest is added to the list. It is done when you release payouts, or press Accept."
                          : c.state === 2
                            ? "Kleros jurors are deciding. Send your evidence (Luma check-ins, photos) on the case page. Once ruled, settle it here."
                            : came
                              ? "This guest was added to the list and gets a share."
                              : "Kleros jurors ruled this guest did not come."}
                    </p>
                    <div className="og-actions">
                      {href && (
                        <a className="kb-btn is-quiet" href={href} target="_blank" rel="noreferrer">
                          Open the Kleros case
                        </a>
                      )}
                      {canMatch && (
                        <>
                          <GradientButton
                            className="is-quiet"
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
                          <GradientButton
                            isDisabled={!canMatchAsAnyone}
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
                      {(c.state === 2 || (c.state === 1 && now > c.matchEndsAt)) && info.phase !== 0 && (
                        <GradientButton
                          className="is-quiet"
                          isDisabled={event.busy}
                          onPress={() =>
                            event.run(
                              "Settle",
                              () => tx.resolveChallenge(info.contract, c.wallet),
                              "Challenge settled.",
                            )
                          }
                        >
                          {c.state === 1 ? "Accept: add them to the list" : "Settle the ruling"}
                        </GradientButton>
                      )}
                    </div>
                  </GlassCard>
                );
              })
            )}
          </section>
          <Messages event={event} />
          {info.phase === 1 ? (
            <GlassCard className="og-card">
              <h3 className="og-h2">Release payouts</h3>
              <p className="og-lede">
                Splits the pool among the attendees. A share is held for each open Kleros case until it is decided.
                Anyone can press it once the window is over.
              </p>
              <div className="og-actions">
                <GradientButton isDisabled={!!releaseReason || event.busy} onPress={() => setConfirm("release")}>
                  Release payouts
                </GradientButton>
                {releaseReason && <span className="og-note">{releaseReason}</span>}
              </div>
            </GlassCard>
          ) : (
            <GlassCard className="og-card">
              <h3 className="og-h2">Payouts released</h3>
              <p className="og-lede">
                Each attendee can claim {assetText(info.payoutShare, info)} on the event page. You can also send every
                attendee their share now (you pay the network fee).
              </p>
              <div className="og-actions">
                <GradientButton
                  isDisabled={event.busy || data.attendees.length === 0}
                  onPress={() => {
                    const first = batches(data.attendees, BATCH_SIZE)[0] ?? [];
                    event.run("Send", () => tx.distribute(info.contract, first), `Sent to ${first.length} attendees.`);
                  }}
                >
                  {`Send to ${Math.min(data.attendees.length, BATCH_SIZE)} attendees`}
                </GradientButton>
              </div>
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
            { label: "Attendees", value: String(info.attendeeCount) },
            { label: "Unanswered challenges accepted", value: String(expired.length) },
          ]}
          action="Release payouts"
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            event.run(
              "Release",
              () => tx.releasePayouts(info.contract, expired),
              "Payouts released. Attendees can claim now.",
            );
          }}
        />
      )}
    </div>
  );
}
