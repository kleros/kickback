"use client";

import { useState } from "react";

import { batches, BATCH_SIZE } from "@kickback/core";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { caseUrl } from "@/config/protocol";

import { Messages } from "./Messages";
import { ConfirmDialog, Figures } from "./parts";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { assetText, ethText, shortHex, TYPED_WORDS } from "../model/view";
import { tx } from "../operations/tx";

const when = (unix: number) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(unix * 1000));

const STATE = ["None", "Waiting for you", "With Kleros", "Decided"] as const;

export function PayoutScreen() {
  const event = useOrganiserEvent();
  const [confirm, setConfirm] = useState<"release" | null>(null);
  const data = event.overview.data;
  if (!data) return <p className="og-note">Reading the event…</p>;
  const info = data.event;
  const now = data.now;
  const canSend = event.isOwner && !event.busy;
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
              { label: "Kleros cases", value: String(disputed.length) },
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
                return (
                  <GlassCard key={c.wallet} className="og-card" data-testid="challenge-row">
                    <div className="og-head-row">
                      <span className="og-mono" title={c.wallet}>
                        {shortHex(c.wallet)}
                      </span>
                      <span className="og-note">
                        {STATE[c.state] ?? "Unknown"}
                        {c.state === 1 &&
                          (now <= c.matchEndsAt ? ` · answer by ${when(c.matchEndsAt)}` : " · not answered in time")}
                      </span>
                    </div>
                    <p className="og-lede">
                      {c.state === 1
                        ? `This guest says they came and paid ${ethText(c.deposit)}. If they did, add them to the list and they get it back. If not, match it with the same amount and Kleros jurors decide; the side they agree with is refunded.`
                        : c.state === 2
                          ? "Kleros jurors are deciding. Send your evidence (check-in records, photos) on the case page. Once ruled, settle it here."
                          : "Settled."}
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
                            isDisabled={!canSend}
                            onPress={() =>
                              event.run(
                                "Match",
                                () => tx.matchChallenge(info.contract, c.wallet, c.deposit),
                                "Matched. The case is now with Kleros.",
                              )
                            }
                          >
                            {`Match · ${ethText(c.deposit)}`}
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
                          Settle
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
