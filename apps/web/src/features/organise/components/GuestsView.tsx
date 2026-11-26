"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { batches, BATCH_SIZE } from "@kickback/core";
import { formatUnits } from "viem";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { DEFAULT_CHAIN } from "@/config/chains";

import { GuestCheck } from "./GuestCheck";
import { LumaMatch } from "./LumaMatch";
import { Messages } from "./Messages";
import { ConfirmDialog } from "./parts";
import { useEventRecord } from "../hooks/useEventRecord";
import { useLumaBook } from "../hooks/useLumaBook";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { recordCsv, type RecordCsvRow, type WalletRecord } from "../model/record";
import { assetText, shortHex } from "../model/view";
import type { GuestRow } from "../operations/read";
import { tx } from "../operations/tx";

/** Seconds before the start when turning guests away stops: about one block, so a send still lands in time. */
const TURN_AWAY_SLACK = 15;

const STATUS = ["No deposit", "Deposited", "Turned away", "Refunded"] as const;
const TONE = ["end", "ok", "warn", "end"] as const;

/**
 * A guest's status as the table shows it, with its dot's tone: one place, so the text and the colour agree.
 * `refundable`: the event is cancelled or its deadline was missed, so every deposit can be withdrawn.
 */
export function guestStatus(
  row: GuestRow,
  phase: number,
  refundable: boolean,
): { text: string; tone: "ok" | "warn" | "end" } {
  if (row.status !== 1) return { text: STATUS[row.status] ?? "Unknown", tone: TONE[row.status] ?? "end" };
  if (refundable) return { text: "Can withdraw deposit", tone: "warn" };
  if (phase === 0) return { text: row.attended ? "On the list" : "Deposited", tone: "ok" };
  if (row.attended) return { text: "Came", tone: "ok" };
  if (row.challenge?.state === 1) return { text: "Challenged", tone: "warn" };
  if (row.challenge?.state === 2) return { text: "With Kleros", tone: "warn" };
  return { text: "Not on the list", tone: "end" };
}

const statusText = (row: GuestRow, phase: number, refundable: boolean) => guestStatus(row, phase, refundable).text;

/** Numbers the payments of one kind only when there are several: "Payout", or "Payout 1", "Payout 2". */
const numbered = (label: string, list: readonly { tx: string }[]) =>
  list.map((p, i) => ({ label: list.length > 1 ? `${label} ${i + 1}` : label, tx: p.tx }));

/** The transactions behind one guest: their deposit, their challenge, then each payment by what it was for. */
function txLinks(rec: WalletRecord | undefined) {
  if (!rec) return [];
  const links: { label: string; tx: string }[] = [];
  if (rec.deposit) links.push({ label: "Deposit", tx: rec.deposit.tx });
  if (rec.challenge) links.push({ label: "Challenge", tx: rec.challenge.tx });
  links.push(
    ...numbered(
      "Refund",
      rec.payments.filter((p) => p.kind === "refund"),
    ),
  );
  links.push(
    ...numbered(
      "Payout",
      rec.payments.filter((p) => p.kind === "payout"),
    ),
  );
  links.push(
    ...numbered(
      "Challenge money back",
      rec.payments.filter((p) => p.kind === "challenge"),
    ),
  );
  return links;
}

const sum = (list: readonly { amount: bigint }[]) => list.reduce((total, p) => total + p.amount, 0n);
const sameWallet = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function GuestsScreen() {
  const event = useOrganiserEvent();
  const record = useEventRecord(event.address);
  const luma = useLumaBook(event.address, event.isOwner);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [search, setSearch] = useState("");
  const firstSeen = useRef<Set<string> | null>(null);
  const data = event.overview.data;
  const guests = useMemo(() => data?.guests ?? [], [data]);
  const booked = useMemo(() => guests.filter((g) => g.status === 1).map((g) => g.wallet), [guests]);
  // a search or a selection belongs to the wallet that made it: drop both on Disconnect or an account switch
  const accountKey = event.account?.toLowerCase();
  useEffect(() => {
    setTicked(new Set());
    setSearch("");
    setConfirm(false);
  }, [accountKey]);
  if (!data) return <p className="og-note">Loading the event…</p>;
  const info = data.event;
  if (firstSeen.current === null) firstSeen.current = new Set(guests.map((g) => g.wallet.toLowerCase()));
  // the contract turns guests away only before the start (v2)
  // the chain's clock, re-read every block, so the controls go the moment the event starts
  const now = event.now ?? data.now;
  // a turn-away sent in the last block before the start lands after it and is refused: stop a block early
  const open = info.phase === 0 && now + TURN_AWAY_SLACK < info.eventStart;
  const canAct = event.isOwner && event.onChain && open && !event.busy;
  // walk-ins can deposit until the end, but nobody can be turned away once the event has started
  const live = info.phase === 0 && now >= info.eventStart && now < info.eventEnd;
  // deposits closed at the end; a posted list or a payout means the end has passed (the contract's own rule)
  const ended = info.phase !== 0 || now >= info.eventEnd;
  const closed =
    info.phase === 3
      ? ("cancelled" as const)
      : info.phase === 0 && now > info.claimDeadline
        ? ("missed" as const)
        : undefined;
  const chosen = guests.filter((g) => ticked.has(g.wallet.toLowerCase()) && g.status === 1);
  // one refund per wallet: a large selection is sent in batches, like the attendance list and the payouts
  const first = chosen.slice(0, BATCH_SIZE);
  const batched = batches(chosen, BATCH_SIZE).length > 1;
  const explorer = DEFAULT_CHAIN.blockExplorers?.default.url;
  const txUrl = (hash: string) => (explorer ? `${explorer}/tx/${hash}` : hash);
  const recOf = (wallet: string) => record.data?.wallets.get(wallet.toLowerCase());
  const download = () => {
    const r = record.data;
    // the record is exact: every amount in full, never the rounded text of the screen
    const exact = (units: bigint, eth = false) =>
      eth && info.symbol !== "ETH"
        ? `${formatUnits(units, 18)} ETH`
        : `${formatUnits(units, info.decimals)} ${info.symbol}`;
    const isGuest = new Set(guests.map((g) => g.wallet.toLowerCase()));
    const who = (wallet: string | undefined) =>
      sameWallet(wallet, info.owner)
        ? "the organiser"
        : wallet && isGuest.has(wallet.toLowerCase())
          ? "the guest"
          : wallet;
    const paymentCell = (p: WalletRecord["payments"][number], account: string) => {
      const how =
        p.via === "claimed"
          ? `claimed by ${who(account)}`
          : p.via === "sent"
            ? `sent by ${who(p.sender) ?? "someone"}`
            : p.kind === "challenge"
              ? "paid back by the contract"
              : p.kind === "refund"
                ? "refunded by the contract"
                : "paid by the contract";
      return `${exact(p.amount, p.eth)} to ${p.to}, ${how}: ${txUrl(p.tx)}`;
    };
    const money = (rec: WalletRecord | undefined, wallet: string) => {
      const asset = rec?.payments.filter((p) => p.kind !== "challenge") ?? [];
      const back = rec?.payments.filter((p) => p.kind === "challenge") ?? [];
      return {
        paid: asset.length ? exact(sum(asset)) : "",
        paymentTxs: asset.map((p) => paymentCell(p, wallet)).join(" | "),
        challengeBack: back.length ? `${formatUnits(sum(back), 18)} ETH` : "",
        challengeTxs: back.map((p) => paymentCell(p, wallet)).join(" | "),
      };
    };
    const failedNotes = (rec: WalletRecord | undefined) =>
      (rec?.failed ?? []).map(
        (f) => `A payment of ${exact(f.amount, f.eth)} was refused by the wallet and kept claimable: ${txUrl(f.tx)}`,
      );
    const rows: RecordCsvRow[] = [...guests].map((g) => {
      const rec = recOf(g.wallet);
      const c = rec?.challenge;
      const payout = sum(rec?.payments.filter((p) => p.kind === "payout") ?? []);
      const base = statusText(g, info.phase, closed !== undefined);
      const status =
        g.status === 1 && info.phase === 2 && g.attended
          ? payout >= info.payoutShare
            ? "Came · paid"
            : payout > 0n
              ? "Came · partly paid"
              : "Came · not paid yet"
          : g.status === 2
            ? rec?.payments.some((p) => p.kind === "refund")
              ? "Turned away · refunded"
              : "Turned away · refund claimable"
            : base;
      const answer = c?.answer;
      return {
        name: luma.nameOf(g.wallet),
        wallet: g.wallet,
        status,
        deposit: exact(info.depositAmount),
        depositTx: rec?.deposit ? txUrl(rec.deposit.tx) : undefined,
        ...money(rec, g.wallet),
        challengeFee: c ? `${formatUnits(c.fee, 18)} ETH` : undefined,
        challengeTx: c ? txUrl(c.tx) : undefined,
        answer: !answer
          ? c
            ? "Not answered yet"
            : undefined
          : answer.kind === "added"
            ? "Added by the organiser"
            : answer.kind === "kleros"
              ? `Sent to Kleros (case ${answer.caseId}) by ${sameWallet(answer.matcher, info.owner) ? "the organiser" : answer.matcher}`
              : answer.kind === "unanswered"
                ? "Accepted unanswered"
                : "Accepted",
        answerTx: answer ? txUrl(answer.tx) : undefined,
        ruling: c?.resolved
          ? c.resolved.ruling === 1
            ? "Came"
            : c.resolved.ruling === 2
              ? "Did not come"
              : "Refused to rule (split)"
          : answer?.kind === "kleros"
            ? "Not ruled yet"
            : undefined,
        settledTx: c?.resolved ? txUrl(c.resolved.tx) : undefined,
        notes: [
          ...failedNotes(rec),
          ...(c?.heldSplit
            ? [
                `Their held share was split among the attendees: ${exact(c.heldSplit.each)} each: ${txUrl(c.heldSplit.tx)}`,
              ]
            : []),
        ].join(" | "),
      };
    });
    // everyone else the event paid or who paid a Kleros fee: the matcher (often the organiser), any other wallet
    const others: RecordCsvRow[] = [...(r?.wallets.entries() ?? [])]
      .filter(
        ([key, rec]) =>
          !isGuest.has(key) && (rec.payments.length > 0 || rec.klerosFees.length > 0 || rec.failed.length > 0),
      )
      .map(([key, rec]) => {
        const organiser = sameWallet(key, info.owner);
        const n = rec.klerosFees.length;
        return {
          wallet: key,
          status: n
            ? `Sent ${n} ${n === 1 ? "case" : "cases"} to Kleros${organiser ? " (organiser)" : ""}`
            : organiser
              ? "Organiser"
              : "Other wallet",
          ...money(rec, key),
          challengeFee: n ? `${formatUnits(sum(rec.klerosFees), 18)} ETH` : undefined,
          challengeTx: rec.klerosFees.map((f) => txUrl(f.tx)).join(" "),
          notes: [
            ...rec.klerosFees.map(
              (f) =>
                `Paid the ${formatUnits(f.amount, 18)} ETH Kleros fee for ${f.staker} (case ${f.caseId}): ${txUrl(f.tx)}`,
            ),
            ...failedNotes(rec),
          ].join(" | "),
        };
      });
    const steps = [
      r?.created && { label: "Event created", tx: txUrl(r.created.tx) },
      r?.listClosed && { label: "Attendance list closed", tx: txUrl(r.listClosed.tx) },
      r?.released && {
        label: "Payouts released",
        detail: `Each attendee's share: ${exact(r.released.share)}`,
        tx: txUrl(r.released.tx),
      },
      ...[...(r?.wallets.entries() ?? [])]
        .filter(([, rec]) => rec.challenge?.heldSplit)
        .map(([key, rec]) => ({
          label: "Lost case's share split among the attendees",
          detail: `${key}: ${exact(rec.challenge!.heldSplit!.each)} each`,
          tx: txUrl(rec.challenge!.heldSplit!.tx),
        })),
      r?.cancelled && { label: "Event cancelled", tx: txUrl(r.cancelled.tx) },
    ].filter((step): step is { label: string; detail?: string; tx: string } => !!step);
    const blob = new Blob([recordCsv([...rows, ...others], steps)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(info.eventName || "event").replace(/[^\w-]+/g, "-")}-record.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const isNew = (wallet: string) => !firstSeen.current?.has(wallet.toLowerCase());
  const q = search.trim().toLowerCase();
  const rows = [...guests].reverse().filter((g) => {
    if (!q) return true;
    const person = luma.names[g.wallet.toLowerCase()];
    return (
      g.wallet.toLowerCase().includes(q) ||
      !!person?.name.toLowerCase().includes(q) ||
      !!person?.email.toLowerCase().includes(q)
    );
  });
  const fresh = guests.filter((g) => isNew(g.wallet)).length;
  const turnedAway = guests.filter((g) => g.status === 2).length;
  const refunded = guests.filter((g) => g.status === 3).length;
  const toggle = (wallet: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(wallet.toLowerCase());
    else next.delete(wallet.toLowerCase());
    setTicked(next);
  };

  return (
    <div className="flex flex-col gap-5" data-testid="guests">
      <div className="flex flex-col gap-1">
        <h2 className="kb-h1">Guests</h2>
        <p className="og-lede" data-testid="guest-count">
          <b>{info.stakerCount}</b> {info.stakerCount === 1 ? "deposit" : "deposits"}
          {info.capacity ? ` of ${info.capacity} ${info.capacity === 1 ? "spot" : "spots"}` : ""}
          {turnedAway > 0 && ` · ${turnedAway} turned away`}
          {refunded > 0 && ` · ${refunded} refunded`}
          {fresh > 0 && ` · ${fresh} new since you opened this page`}
        </p>
      </div>

      <GlassCard className="og-card">
        <GuestCheck
          contract={event.address}
          guests={guests}
          nameOf={luma.nameOf}
          lumaOf={luma.lumaOf}
          approvedAt={luma.approvedAt}
          check={luma.check}
          closed={closed}
          ended={ended}
          statusOf={(w) => {
            const g = guests.find((x) => x.wallet.toLowerCase() === w.toLowerCase());
            return g ? statusText(g, info.phase, closed !== undefined) : undefined;
          }}
        />
      </GlassCard>
      {event.isOwner && (
        <GlassCard className="og-card">
          <LumaMatch booked={booked} onRows={luma.add} ended={ended} />
        </GlassCard>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="og-h2">All deposits</h2>
          <p className="og-lede">
            {open
              ? `Newest first. Until the event starts, you can turn anyone away: they get their ${assetText(info.depositAmount, info)} back in full and cannot deposit again.`
              : live
                ? "Newest first. Guests can only be turned away before the event starts, so let in every walk-in who has deposited."
                : info.phase === 3
                  ? "Newest first. The event was cancelled, so every guest can withdraw their full deposit on the guest page."
                  : closed === "missed"
                    ? "Newest first. Attendance was not confirmed in time, so every guest can withdraw their full deposit on the guest page."
                    : "Newest first. Guests could only be turned away before the event started."}
          </p>
        </div>
        {guests.length > 0 && event.isOwner && !guests.some((g) => luma.nameOf(g.wallet)) && (
          <p className="og-note">Names appear once you load the Luma export above. They stay in this browser only.</p>
        )}
        {guests.length > 0 && (
          <div className="og-actions">
            <GradientButton className="is-quiet" isDisabled={!record.data} onPress={download}>
              Download the record (CSV)
            </GradientButton>
            <span className="og-note">
              {record.isError
                ? "The transactions could not be read. Reload to try again."
                : record.data
                  ? "Every guest with their deposit and payout transactions."
                  : "Reading the transactions…"}
            </span>
          </div>
        )}
        {guests.length > 0 && (
          <input
            className="og-input"
            type="search"
            placeholder={event.isOwner ? "Search name, email or wallet" : "Search wallet"}
            aria-label="Search guests"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        )}
        {guests.length === 0 ? (
          <GlassCard className="og-card" data-testid="guests-empty">
            <h3 className="og-h2">No deposits yet</h3>
            <p className="og-lede">Guests appear here as soon as they deposit on the guest page.</p>
          </GlassCard>
        ) : (
          <div className="og-table is-guests" role="table" aria-label="Guests">
            <div className="og-thead" role="row">
              <span>Name</span>
              <span>Wallet</span>
              <span>Deposit</span>
              <span>Transactions</span>
              <span>Status</span>
              <span className="text-right">{open ? "Turn away" : ""}</span>
            </div>
            {rows.map((row) => {
              const name = luma.nameOf(row.wallet);
              return (
                <div
                  key={row.wallet}
                  className="og-row"
                  data-testid="guest-row"
                  data-wallet={row.wallet.toLowerCase()}
                  data-new={isNew(row.wallet) || undefined}
                >
                  <div className="og-row-main">
                    <span className="og-cell-person">
                      {name ? (
                        <span className="og-cell-name">{name}</span>
                      ) : (
                        <span className="og-cell-noname" title="Load the Luma export above to see names">
                          —
                        </span>
                      )}
                    </span>
                    <span className="og-cell-wallet" title={row.wallet}>
                      <span className="og-mono">{shortHex(row.wallet)}</span>
                      {isNew(row.wallet) && <span className="og-new">New</span>}
                    </span>
                    <span className="og-cell-hide kb-num">{assetText(info.depositAmount, info)}</span>
                    <span className="og-cell-txs" data-testid="guest-txs">
                      <span className="og-only-phone og-note">Transactions:</span>
                      {txLinks(recOf(row.wallet)).map((link) =>
                        explorer ? (
                          <a
                            key={link.tx + link.label}
                            className="kb-link"
                            href={txUrl(link.tx)}
                            target="_blank"
                            rel="noreferrer"
                            title={link.tx}
                          >
                            {link.label}
                          </a>
                        ) : (
                          <span key={link.tx + link.label} className="og-note og-mono" title={link.tx}>
                            {link.label}
                          </span>
                        ),
                      )}
                    </span>
                    {(() => {
                      const st = guestStatus(row, info.phase, closed !== undefined);
                      return (
                        <span className="og-cell-status">
                          <span className="og-dot" data-tone={st.tone} aria-hidden />
                          <span>{st.text}</span>
                        </span>
                      );
                    })()}
                    <span className="og-ticks">
                      {open && row.status === 1 && (
                        <label className="og-tick">
                          <input
                            type="checkbox"
                            checked={ticked.has(row.wallet.toLowerCase())}
                            disabled={!canAct}
                            aria-label={`Turn away ${row.wallet}`}
                            onChange={(e) => toggle(row.wallet, e.currentTarget.checked)}
                          />
                          <span className="md:sr-only">Turn away</span>
                        </label>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <p className="og-note py-3">No guest matches “{search}”.</p>}
          </div>
        )}
        {open && chosen.length > 0 && (
          <GlassCard className="og-selbar og-thumb">
            <span className="og-note" data-testid="selection">
              {chosen.length} selected
            </span>
            <div className="og-actions">
              <GradientButton className="is-quiet" onPress={() => setTicked(new Set())}>
                Clear
              </GradientButton>
              <GradientButton
                isDisabled={!canAct}
                isPending={event.running?.startsWith("Turn away")}
                glyph={event.running?.startsWith("Turn away") ? "arc" : undefined}
                onPress={() => setConfirm(true)}
              >
                {batched
                  ? `Turn away ${first.length} of ${chosen.length} · refund now`
                  : `Turn away ${chosen.length} · refund now`}
              </GradientButton>
            </div>
          </GlassCard>
        )}
        <Messages event={event} />
      </section>

      {confirm && open && (
        <ConfirmDialog
          isOpen
          title={first.length === 1 ? "Turn a guest away" : `Turn ${first.length} guests away`}
          intro={`Each wallet gets ${assetText(info.depositAmount, info)} back now and cannot deposit for this event again.${
            batched
              ? ` This sends the first ${first.length} of ${chosen.length}. Send the rest after it is confirmed.`
              : ""
          }`}
          words={[]}
          figures={[
            { label: "Wallets", value: String(first.length) },
            { label: "To refund", value: assetText(info.depositAmount * BigInt(first.length), info) },
          ]}
          extra={
            <ul className="og-mono" style={{ overflowWrap: "anywhere" }}>
              {first.map((g) => (
                <li key={g.wallet}>
                  {luma.nameOf(g.wallet) ? `${luma.nameOf(g.wallet)} · ` : ""}
                  {g.wallet}
                </li>
              ))}
            </ul>
          }
          action={`Turn away ${first.length}`}
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            const wallets = first.map((g) => g.wallet);
            const left = chosen.length - wallets.length;
            setConfirm(false);
            // the ticks stay until the refund is confirmed: a cancel in the wallet keeps the selection
            event.run(
              `Turn away ${wallets.length}`,
              () => tx.reject(info.contract, wallets),
              `${wallets.length} ${wallets.length === 1 ? "guest" : "guests"} turned away and refunded.${
                left > 0 ? ` Send the next ${Math.min(BATCH_SIZE, left)}.` : ""
              }`,
              () =>
                setTicked((prev) => {
                  const next = new Set(prev);
                  wallets.forEach((w) => next.delete(w.toLowerCase()));
                  return next;
                }),
              { TooLate: "The event has started, so guests can no longer be turned away. Nothing was sent." },
            );
          }}
        />
      )}
    </div>
  );
}
