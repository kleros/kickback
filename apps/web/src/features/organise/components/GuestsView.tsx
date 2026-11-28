"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { batches, BATCH_SIZE } from "@kickback/core";
import { formatUnits, getAddress } from "viem";

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
import { guestStatus } from "../model/guestStatus";
import { recordCsv, type EventRecord, type RecordCsvRow, type WalletRecord } from "../model/record";
import { assetText, shortHex } from "../model/view";
import type { GuestRow, OrganiserState } from "../operations/read";
import { tx } from "../operations/tx";

/** Seconds before the start when turning guests away stops: about one block, so a send still lands in time. */
const TURN_AWAY_SLACK = 15;

/** Numbers the payments of one kind only when there are several: "Payout", or "Payout 1", "Payout 2". */
const numbered = (label: string, list: readonly { tx: string; block: bigint }[]) =>
  list.map((p, i) => ({ label: list.length > 1 ? `${label} ${i + 1}` : label, tx: p.tx, block: p.block }));

/**
 * The transactions behind one guest, in the order they happened (by block): their deposit, their challenge, being
 * put on the list, each payment by what it was for. Links in the same block keep the order below.
 */
export function txLinks(rec: WalletRecord | undefined) {
  if (!rec) return [];
  const links: { label: string; tx: string; block: bigint }[] = [];
  if (rec.deposit) links.push({ label: "Deposit", tx: rec.deposit.tx, block: rec.deposit.block });
  const c = rec.challenge;
  if (c) {
    links.push({ label: "Challenge", tx: c.tx, block: c.block });
    if (c.answer)
      links.push({
        label:
          c.answer.kind === "kleros"
            ? `Sent to Kleros (case ${c.answer.caseId})`
            : c.answer.kind === "added"
              ? "Added"
              : c.answer.kind === "unanswered"
                ? "Accepted (no answer in time)"
                : "Accepted",
        tx: c.answer.tx,
        block: c.answer.block,
      });
  }
  // put on the list by the organiser (not as a challenge's answer, which is linked above)
  const added = rec.added;
  if (added && added.how !== "challenge" && !links.some((l) => l.tx === added.tx))
    links.push({
      label: added.how === "saved" ? "Attendance saved" : added.how === "late" ? "Added to the list" : "Listed",
      tx: added.tx,
      block: added.block,
    });
  // a Kleros fee this wallet paid to send someone else's challenge to Kleros
  links.push(
    ...rec.klerosFees
      .filter((f) => !links.some((l) => l.tx === f.tx))
      .map((f) => ({ label: `Kleros fee (case ${f.caseId})`, tx: f.tx, block: f.block })),
  );
  // numbered in chain order before the sort, so "Payout 1" is the first payout
  links.push(
    ...numbered(
      "Refund",
      rec.payments.filter((p) => p.kind === "refund"),
    ),
  );
  links.push(
    ...numbered(
      "Challenge money back",
      rec.payments.filter((p) => p.kind === "challenge"),
    ),
  );
  links.push(
    ...numbered(
      "Payout",
      rec.payments.filter((p) => p.kind === "payout"),
    ),
  );
  // the settlement and the held-share split, unless a payment above already links the same transaction
  if (c?.resolved && !links.some((l) => l.tx === c.resolved!.tx))
    links.push({ label: "Settled", tx: c.resolved.tx, block: c.resolved.block });
  if (c?.heldSplit && !links.some((l) => l.tx === c.heldSplit!.tx))
    links.push({ label: "Share split", tx: c.heldSplit.tx, block: c.heldSplit.block });
  // a stable sort: links in one block keep the order they were added in
  return links
    .sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0))
    .map(({ label, tx }) => ({ label, tx }));
}

/** A file name from an event name in any script: letters, marks and digits kept, every other run one dash. */
export const recordFileName = (eventName: string) =>
  `${
    (eventName || "")
      .normalize("NFC")
      .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "event"
  }-record.csv`;

const guestsText = (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`;

const sum = (list: readonly { amount: bigint }[]) => list.reduce((total, p) => total + p.amount, 0n);
const sameWallet = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function GuestsScreen() {
  const event = useOrganiserEvent();
  const record = useEventRecord(event.address);
  const luma = useLumaBook(event.address, event.isOwner);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const data = event.overview.data;
  const guests = useMemo(() => data?.guests ?? [], [data]);
  const booked = useMemo(() => guests.filter((g) => g.status === 1).map((g) => g.wallet), [guests]);
  // every guest who ever deposited, with their status (1 deposited, 2 turned away, 3 refunded), for the Luma match
  const statusByWallet = useMemo(
    () => new Map(guests.map((g) => [g.wallet.toLowerCase(), g.status] as const)),
    [guests],
  );
  // a search or a selection belongs to the wallet that made it: drop both on Disconnect or an account switch
  const accountKey = event.account?.toLowerCase();
  useEffect(() => {
    setTicked(new Set());
    setSearch("");
    setConfirm(false);
  }, [accountKey]);
  // the status (15 s poll) and the transactions (30 s poll) are two reads: when the status changes (a claim, a
  // refund, a challenge), read the transactions again so no row says "paid" without its payout link for long
  const sig = data
    ? [
        [...data.sharePaid].join(),
        data.refused.join(),
        data.event.phase,
        data.event.stakerCount,
        data.guests.map((g) => `${g.status}${g.attended ? 1 : 0}${g.challenge?.state ?? ""}`).join(),
      ].join("|")
    : "";
  const lastSig = useRef<string | null>(null);
  const refetchRecord = record.refetch;
  useEffect(() => {
    if (!sig) return;
    if (lastSig.current !== null && lastSig.current !== sig) void refetchRecord();
    lastSig.current = sig;
  }, [sig, refetchRecord]);
  if (!data) return <p className="og-note">Loading the event…</p>;
  const info = data.event;
  // the guests already there when the organiser opened this tab: kept across a wallet switch and back
  const firstSeen = event.isOwner ? event.seenAtOpen(guests.map((g) => g.wallet)) : null;
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
  // after the release, each attendee's payment as the contract has it (not the logs, which load later)
  const refusedSet = new Set(data.refused.map((w) => w.toLowerCase()));
  const payOf = (wallet: string) =>
    info.phase === 2
      ? {
          sharePaid: data.sharePaid.get(wallet.toLowerCase()),
          payoutShare: info.payoutShare,
          refused: refusedSet.has(wallet.toLowerCase()),
          openCases: info.openCases,
        }
      : undefined;
  const statusOfRow = (g: GuestRow) => guestStatus(g, info.phase, closed !== undefined, payOf(g.wallet));
  // the record is built from a fresh read of both the status and the logs, in that order, so the logs are never
  // older than the status they explain
  const download = async () => {
    setDownloading(true);
    setDownloadError(false);
    try {
      const o = await event.overview.refetch();
      const rr = await record.refetch();
      if (o.isError || rr.isError || !o.data || !rr.data) {
        setDownloadError(true);
        return;
      }
      saveRecord(o.data, rr.data);
    } finally {
      setDownloading(false);
    }
  };
  const saveRecord = (d: OrganiserState, r: EventRecord) => {
    const info = d.event;
    const guests = d.guests;
    const now = Math.max(d.now, event.now ?? 0);
    const closed = info.phase === 3 || (info.phase === 0 && now > info.claimDeadline);
    const refusedSet = new Set(d.refused.map((w) => w.toLowerCase()));
    const recOf = (wallet: string) => r.wallets.get(wallet.toLowerCase());
    const statusOfRow = (g: GuestRow) =>
      guestStatus(
        g,
        info.phase,
        closed,
        info.phase === 2
          ? {
              sharePaid: d.sharePaid.get(g.wallet.toLowerCase()),
              payoutShare: info.payoutShare,
              refused: refusedSet.has(g.wallet.toLowerCase()),
              openCases: info.openCases,
            }
          : undefined,
      );
    const splitAmong = (h: { attendees: bigint; openCases: bigint }) =>
      `${h.attendees} ${h.attendees === 1n ? "attendee" : "attendees"}${h.openCases > 0n ? ` and ${h.openCases} open ${h.openCases === 1n ? "case" : "cases"}` : ""}`;
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
    const paymentCell = (p: WalletRecord["payments"][number], account: string, rec?: WalletRecord) => {
      const how =
        p.kind === "refund" && rec?.rejected && p.tx.toLowerCase() === rec.rejected.tx.toLowerCase()
          ? "refunded when the organiser turned them away"
          : p.via === "claimed"
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
      const refunds = rec?.payments.filter((p) => p.kind === "refund") ?? [];
      const payouts = rec?.payments.filter((p) => p.kind === "payout") ?? [];
      const back = rec?.payments.filter((p) => p.kind === "challenge") ?? [];
      return {
        refunded: refunds.length ? exact(sum(refunds)) : "",
        paid: payouts.length ? exact(sum(payouts)) : "",
        paymentTxs: [...refunds, ...payouts].map((p) => paymentCell(p, wallet, rec)).join(" | "),
        challengeBack: back.length ? `${formatUnits(sum(back), 18)} ETH` : "",
        challengeTxs: back.map((p) => paymentCell(p, wallet, rec)).join(" | "),
      };
    };
    const failedNotes = (rec: WalletRecord | undefined) =>
      (rec?.failed ?? []).map(
        (f) => `A payment of ${exact(f.amount, f.eth)} was refused by the wallet and kept claimable: ${txUrl(f.tx)}`,
      );
    const rows: RecordCsvRow[] = [...guests].map((g) => {
      const rec = recOf(g.wallet);
      const c = rec?.challenge;
      const base = statusOfRow(g).text;
      // the record can also tell a turned-away guest's refund that went through from one still claimable
      const status =
        g.status === 2
          ? rec?.payments.some((p) => p.kind === "refund")
            ? "Turned away · refunded"
            : "Turned away · refund claimable"
          : base;
      const answer = c?.answer;
      // the guest row's own on-chain challenge: its answer time, and a Kleros ruling not settled yet
      const live = g.challenge;
      const lapsed = live?.state === 1 && now > live.matchEndsAt;
      const ruledLive = live?.state === 2 && live.isRuled === true && (live.ruling ?? 99) <= 2;
      // the jurors have ruled on Kleros (appeal open, appeal time over, or final) but it is not recorded yet
      const jurors =
        live?.state === 2 && live.isRuled !== true && live.appeal && (live.appeal.end > 0 || live.appeal.final)
          ? live.appeal
          : undefined;
      const word = (r: number | undefined) => (r === 1 ? "Came" : r === 2 ? "Did not come" : "Did not rule either way");
      const added = rec?.added && rec.added.how !== "challenge" ? rec.added : undefined;
      return {
        name: luma.nameOf(g.wallet),
        wallet: g.wallet,
        status,
        deposit: exact(info.depositAmount),
        depositTx: rec?.deposit ? txUrl(rec.deposit.tx) : undefined,
        listedTx: added ? txUrl(added.tx) : undefined,
        ...money(rec, g.wallet),
        challengeFee: c ? `${formatUnits(c.fee, 18)} ETH` : undefined,
        challengeTx: c ? txUrl(c.tx) : undefined,
        answer: !answer
          ? c
            ? lapsed
              ? "Not answered in time (added when payouts are released)"
              : "Not answered yet"
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
              : "Did not rule either way (fees split)"
          : answer?.kind === "kleros"
            ? ruledLive
              ? `${word(live.ruling)} (ruled, not settled yet)`
              : jurors
                ? `${word(jurors.ruling)} (jurors' ruling, ${
                    jurors.final
                      ? "final, not recorded on Kleros yet"
                      : now <= jurors.end
                        ? "appeal open"
                        : "appeal time ended, not final yet"
                  })`
                : "Not ruled yet"
            : undefined,
        settledTx: c?.resolved ? txUrl(c.resolved.tx) : undefined,
        // the case's own match transaction, under the same header as on the matcher's row
        klerosTxs: answer?.kind === "kleros" ? txUrl(answer.tx) : undefined,
        notes: [
          ...(added?.how === "late" ? [`Added to the list after it was closed: ${txUrl(added.tx)}`] : []),
          ...failedNotes(rec),
          ...(c?.heldSplit
            ? [
                `Their held share was split among the ${splitAmong(c.heldSplit)} (${exact(c.heldSplit.each)} each), transaction ${txUrl(c.heldSplit.tx)}`,
              ]
            : []),
        ].join(" | "),
      };
    });
    // everyone else the event paid or who paid a Kleros fee: the matcher (often the organiser), any other wallet
    const others: RecordCsvRow[] = [...r.wallets.entries()]
      .filter(
        ([key, rec]) =>
          !isGuest.has(key) && (rec.payments.length > 0 || rec.klerosFees.length > 0 || rec.failed.length > 0),
      )
      .map(([key, rec]) => {
        const organiser = sameWallet(key, info.owner);
        const n = rec.klerosFees.length;
        return {
          wallet: getAddress(key),
          status: n
            ? `Sent ${n} ${n === 1 ? "case" : "cases"} to Kleros${organiser ? " (organiser)" : ""}`
            : organiser
              ? "Organiser"
              : "Other wallet",
          ...money(rec, key),
          klerosFee: n ? `${formatUnits(sum(rec.klerosFees), 18)} ETH` : undefined,
          klerosTxs: rec.klerosFees.map((f) => txUrl(f.tx)).join(" "),
          notes: [
            ...rec.klerosFees.map(
              (f) =>
                `Paid the ${formatUnits(f.amount, 18)} ETH Kleros fee for ${f.staker} (case ${f.caseId}): ${txUrl(f.tx)}`,
            ),
            ...failedNotes(rec),
          ].join(" | "),
        };
      });
    // anyone can release: name the wallet in full (closing the list and cancelling are the organiser's alone)
    const releasedBy = (w?: string) => {
      if (!w) return undefined;
      if (sameWallet(w, info.owner)) return "the organiser";
      if (!isGuest.has(w.toLowerCase())) return getAddress(w);
      const name = luma.nameOf(w);
      return `the guest ${name ? `${name} ` : ""}${getAddress(w)}`;
    };
    const raised = !!r.released && info.payoutShare !== r.released.share;
    const splits = [...r.wallets.entries()].filter(([, rec]) => rec.challenge?.heldSplit);
    const listedNames = (wallets: readonly string[]) => wallets.map((w) => luma.nameOf(w) || getAddress(w)).join(", ");
    const attendanceStep = (a: EventRecord["attendanceTxs"][number]) => ({
      label: a.how === "saved" ? "Attendance saved" : "Added to the list after it was closed",
      detail:
        a.how === "saved"
          ? `By the organiser; ${guestsText(a.wallets.length)}`
          : `By the organiser; ${listedNames(a.wallets)}`,
      tx: txUrl(a.tx),
    });
    const steps = [
      r?.created && { label: "Event created", tx: txUrl(r.created.tx) },
      ...r.attendanceTxs.filter((a) => a.how === "saved").map(attendanceStep),
      r?.listClosed && {
        label: "Attendance list closed",
        detail: (() => {
          const n = r.attendanceTxs.find((a) => a.how === "closed")?.wallets.length;
          return n ? `By the organiser; ${guestsText(n)} added in the same transaction` : "By the organiser";
        })(),
        tx: txUrl(r.listClosed.tx),
      },
      ...r.attendanceTxs.filter((a) => a.how === "late").map(attendanceStep),
      r?.released && {
        label: "Payouts released",
        detail: [
          raised ? `Share at release: ${exact(r.released.share)}` : `Each attendee's share: ${exact(r.released.share)}`,
          r.released.by && `released by ${releasedBy(r.released.by)}`,
        ]
          .filter(Boolean)
          .join("; "),
        tx: txUrl(r.released.tx),
      },
      ...splits.map(([key, rec]) => {
        const h = rec.challenge!.heldSplit!;
        const name = luma.nameOf(key);
        return {
          label: "Held share split",
          detail: `${name ? `${name} ` : ""}${getAddress(key)}: split among the ${splitAmong(h)}, ${exact(h.each)} each`,
          tx: txUrl(h.tx),
        };
      }),
      raised && {
        label: "Final share per attendee",
        detail: `Each attendee's share after the held shares were split: ${exact(info.payoutShare)}`,
        tx: splits.length ? txUrl(splits[splits.length - 1]![1].challenge!.heldSplit!.tx) : "",
      },
      r?.cancelled && { label: "Event cancelled", detail: "By the organiser", tx: txUrl(r.cancelled.tx) },
    ].filter((step): step is { label: string; detail?: string; tx: string } => !!step);
    const blob = new Blob([recordCsv([...rows, ...others], steps)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = recordFileName(info.eventName);
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const isNew = (wallet: string) => !!firstSeen && !firstSeen.has(wallet.toLowerCase());
  const q = search.trim().toLowerCase();
  // names and emails match without their accents: "diaz" finds "Díaz"
  const fold = (t: string) =>
    t
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/ø/g, "o")
      .replace(/ł/g, "l")
      .replace(/æ/g, "ae")
      .replace(/œ/g, "oe")
      .replace(/đ/g, "d");
  const fq = fold(search.trim());
  const hex = q.startsWith("0x") ? q.slice(2) : q;
  // a wallet match needs 0x and at least one more hex character, or 4 hex characters on their own: a name such
  // as "CC" must not match every wallet with "cc" in it
  const walletQuery = /^[0-9a-f]+$/.test(hex) && (q.startsWith("0x") ? hex.length >= 1 : hex.length >= 4);
  const rows = [...guests].reverse().filter((g) => {
    if (!q) return true;
    const person = luma.names[g.wallet.toLowerCase()];
    const w = g.wallet.toLowerCase();
    return (
      (walletQuery && (q.startsWith("0x") ? w.startsWith(q) : w.slice(2).includes(hex))) ||
      !!(person && fold(person.name).includes(fq)) ||
      !!(person && fold(person.email).includes(fq))
    );
  });
  const lead = guests.length > 0 ? "Newest first. " : "";
  const fresh = guests.filter((g) => isNew(g.wallet)).length;
  const turnedAway = guests.filter((g) => g.status === 2).length;
  const refunded = guests.filter((g) => g.status === 3).length;
  // a turn-away from this wallet still confirming (also after a wallet switch away and back, which remounts the tab)
  const turning = new Set(event.pending?.wallets.map((w) => w.toLowerCase()) ?? []);
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
          recordOf={recOf}
          owner={info.owner}
          me={event.account}
          statusOf={(w) => {
            const g = guests.find((x) => x.wallet.toLowerCase() === w.toLowerCase());
            return g ? statusOfRow(g).text : undefined;
          }}
        />
      </GlassCard>
      {event.isOwner && (
        <GlassCard className="og-card">
          <LumaMatch
            contract={event.address}
            booked={booked}
            statuses={statusByWallet}
            closed={closed}
            onRows={luma.add}
            ended={ended}
          />
        </GlassCard>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="og-h2">All deposits</h2>
          <p className="og-lede">
            {open
              ? `${lead}Until the event starts, you can turn anyone away: they get their ${assetText(info.depositAmount, info)} back in full and cannot deposit again.`
              : live
                ? `${lead}Guests can only be turned away before the event starts, so let in every walk-in who has deposited.`
                : closed === "cancelled"
                  ? guests.length === 0
                    ? "The event was cancelled before anyone deposited."
                    : info.stakerCount > 0
                      ? `${lead}The event was cancelled, so every guest who still has a deposit can withdraw it in full on the guest page.`
                      : `${lead}The event was cancelled and every deposit has been returned.`
                  : closed === "missed"
                    ? guests.length === 0
                      ? "Nobody deposited before the event ended."
                      : info.stakerCount > 0
                        ? `${lead}Attendance was not confirmed in time, so every guest who still has a deposit can withdraw it in full on the guest page.`
                        : `${lead}Attendance was not confirmed in time, and every deposit has been returned.`
                    : guests.length === 0
                      ? "Nobody deposited before the event ended."
                      : `${lead}Guests could only be turned away before the event started.`}
          </p>
        </div>
        {guests.length > 0 && event.isOwner && !guests.some((g) => luma.nameOf(g.wallet)) && (
          <p className="og-note">Names appear once you load the Luma export above. They stay in this browser only.</p>
        )}
        <div className="og-actions">
          <GradientButton
            className="is-quiet"
            isDisabled={!record.data || downloading}
            isPending={downloading}
            onPress={() => void download()}
          >
            Download the record (CSV)
          </GradientButton>
          <span className="og-note" role={downloadError ? "alert" : undefined}>
            {downloadError
              ? "The transactions could not be read. Try again."
              : record.isError
                ? "The transactions could not be read. Reload to try again."
                : record.data
                  ? guests.length > 0
                    ? info.phase === 2
                      ? "Every guest with their deposit, refund, challenge and payout transactions."
                      : closed
                        ? "Every guest with their transactions so far. Each refund is added as it happens."
                        : "Every guest with their transactions so far. Payouts are added once they are released."
                    : closed
                      ? "The event's transactions so far."
                      : "The event's transactions so far. Each guest's deposit, refund and payout transactions are added as they happen."
                  : "Reading the transactions…"}
          </span>
        </div>
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
            {ended ? (
              <h3 className="og-h2">No one deposited</h3>
            ) : (
              <>
                <h3 className="og-h2">No deposits yet</h3>
                <p className="og-lede">Guests appear here as soon as they deposit on the guest page.</p>
              </>
            )}
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
                        <span className="og-cell-name" title={name}>
                          {name}
                        </span>
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
                      const st = turning.has(row.wallet.toLowerCase())
                        ? { tone: "warn", text: "Turning away" }
                        : statusOfRow(row);
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
                            checked={ticked.has(row.wallet.toLowerCase()) || turning.has(row.wallet.toLowerCase())}
                            disabled={!canAct || turning.has(row.wallet.toLowerCase())}
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
                  ? `Turn away ${first.length} of ${guestsText(chosen.length)} · refund now`
                  : `Turn away ${guestsText(chosen.length)} · refund now`}
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
          intro={`${first.length === 1 ? "They get" : "Each guest gets"} ${assetText(info.depositAmount, info)} back now and cannot deposit for this event again.${
            batched
              ? ` This sends the first ${first.length} of ${chosen.length}. Send the rest after it is confirmed.`
              : ""
          }`}
          words={[]}
          figures={[
            { label: "Guests", value: String(first.length) },
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
          action={`Turn away ${guestsText(first.length)}`}
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            const wallets = first.map((g) => g.wallet);
            const left = chosen.length - wallets.length;
            // a guest already approved on Luma keeps a working Luma registration: say to decline them there
            const approved = wallets.filter(
              (w) =>
                luma.lumaOf(w) !== "declined" && (luma.approvedAt(w) !== undefined || luma.lumaOf(w) === "approved"),
            ).length;
            const lumaReminder =
              approved === 0
                ? ""
                : wallets.length === 1
                  ? " They were approved on Luma, so decline them there."
                  : approved === 1
                    ? " 1 of them was approved on Luma, so decline them there."
                    : ` ${approved} of them were approved on Luma, so decline them there.`;
            setConfirm(false);
            // the ticks stay until the refund is confirmed: a cancel in the wallet keeps the selection
            event.run(
              `Turn away ${wallets.length}`,
              () => tx.reject(info.contract, wallets),
              `${wallets.length} ${wallets.length === 1 ? "guest" : "guests"} turned away and refunded.${lumaReminder}${
                left > 0 ? ` Send the next ${Math.min(BATCH_SIZE, left)}.` : ""
              }`,
              () =>
                setTicked((prev) => {
                  const next = new Set(prev);
                  wallets.forEach((w) => next.delete(w.toLowerCase()));
                  return next;
                }),
              { TooLate: "The event has started, so guests can no longer be turned away. Nothing was sent." },
              { pending: `Turning away ${guestsText(wallets.length)}… Waiting for confirmation.`, wallets },
            );
          }}
        />
      )}
    </div>
  );
}
