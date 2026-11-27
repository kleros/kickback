"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";

import { attendanceFromCsv, batches, BATCH_SIZE } from "@kickback/core";
import { Button } from "react-aria-components";
import type { Address } from "viem";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { spanText } from "@/utils/time";

import { paths } from "@/config/paths";

import { Messages } from "./Messages";
import { ConfirmDialog, CSV_ERROR, ErrorLine, FilePick, Figures, Locked, TxLink } from "./parts";
import { useEventRecord } from "../hooks/useEventRecord";
import { useLumaBook } from "../hooks/useLumaBook";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { forgetCheckin, readCheckin, writeCheckin } from "../model/lumaBook";
import { matchLuma } from "../model/lumaMatch";
import { projectedShare } from "../model/payout";
import { gate } from "../model/shared";
import { assetText, shortHex, TYPED_WORDS, when } from "../model/view";
import { tx } from "../operations/tx";

const SKIP_TEXT = {
  "no-wallet": "No wallet in the row",
  "not-a-guest": "No deposit from this wallet",
  "not-checked-in": "Not checked in on Luma",
  duplicate: "Listed twice",
} as const;

const guests = (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`;

export function AttendanceScreen() {
  const event = useOrganiserEvent();
  const luma = useLumaBook(event.address, event.isOwner);
  const record = useEventRecord(event.address);
  const [csv, setCsv] = useState<{ name: string; text: string; at?: number } | null>(null);
  const [err, setErr] = useState<{ text: string; at: number } | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [confirm, setConfirm] = useState<"close" | "save" | null>(null);
  const emptyId = useId();
  const data = event.overview.data;
  const booked = useMemo(() => data?.booked ?? [], [data]);
  const plan = useMemo(() => (csv ? attendanceFromCsv(csv.text, booked) : null), [csv, booked]);
  // the loaded check-in export and its ticks are kept per event in this browser, like the Guests tab's export:
  // shown only while the organiser's wallet is connected, hidden (not deleted) for any other wallet or none
  const accountKey = event.account?.toLowerCase();
  const isOwner = event.isOwner;
  const contract = event.address;
  useEffect(() => {
    setErr(null);
    setConfirm(null);
    const load = () => {
      const saved = isOwner ? readCheckin(contract) : null;
      setCsv(saved ? { name: saved.name, text: saved.text, at: saved.at } : null);
      setPicked(saved?.picked ? new Set(saved.picked) : null);
    };
    load();
    // a forget on another tab (or "Forget this export" on the Guests tab) clears it here too
    window.addEventListener("storage", load);
    window.addEventListener("kb-luma", load);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener("kb-luma", load);
    };
  }, [accountKey, isOwner, contract]);
  /** Saves the organiser's ticks with the loaded export (null: back to the export's own check-ins). */
  const savePicked = (next: Set<string> | null) => {
    if (!event.isOwner || !csv) return;
    const saved = readCheckin(event.address);
    if (!saved) return;
    writeCheckin(event.address, { ...saved, picked: next ? [...next] : undefined });
  };
  if (!data) return <p className="og-note">Loading the event…</p>;
  const info = data.event;
  // the same chain clock as the header pill and the other tabs (the overview read can be 15 s old)
  const now = event.now ?? data.now;
  const already = new Set(data.attendees.map((a) => a.toLowerCase()));
  // a guest in a Kleros case cannot be added (the contract refuses it): the jurors decide
  const inCase = new Set(data.guests.filter((g) => g.challenge?.state === 2).map((g) => g.wallet.toLowerCase()));
  // the organiser's ticks start from the CSV's check-ins, or from who is already on the list
  const chosen = picked ?? new Set((plan?.attending ?? []).map((a) => a.toLowerCase()));
  const isOn = (w: Address) =>
    already.has(w.toLowerCase()) || (chosen.has(w.toLowerCase()) && !inCase.has(w.toLowerCase()));
  const toAdd = booked.filter(
    (w) => !already.has(w.toLowerCase()) && chosen.has(w.toLowerCase()) && !inCase.has(w.toLowerCase()),
  );
  const listed = info.phase === 1;
  const inWindow = info.phase === 0 && now >= info.eventEnd && now <= info.claimDeadline;
  const canAdd = event.isOwner && event.onChain && !event.busy && (inWindow || (listed && now <= info.challengeEndsAt));
  const total = booked.filter(isOn).length;
  // a guest whose challenge is waiting or with Kleros is neither on the list nor a no-show yet
  const isChallenging = (c: { wallet: Address; state: number }) => (c.state === 1 || c.state === 2) && !isOn(c.wallet);
  const challenging = data.challenges.filter(isChallenging).length;
  const noShows = booked.length - total - challenging;
  // one transaction per batch, before and after the list is closed; the dialog says what one press sends
  const parts = batches(toAdd, BATCH_SIZE);
  const first = parts[0] ?? [];
  const batched = parts.length > 1;
  const afterSend = total - (toAdd.length - first.length);
  const sentSet = new Set(first.map((w) => w.toLowerCase()));
  const challengingAfter = data.challenges.filter(
    (c) =>
      (c.state === 1 || c.state === 2) && !already.has(c.wallet.toLowerCase()) && !sentSet.has(c.wallet.toLowerCase()),
  ).length;
  const final = confirm === "close" && !batched;
  const isBooked = new Set(booked.map((w) => w.toLowerCase()));
  const unscanned = new Set(
    (plan?.skipped ?? [])
      .filter(
        (s) =>
          s.reason === "not-checked-in" &&
          s.wallet &&
          isBooked.has(s.wallet.toLowerCase()) &&
          // a second, checked-in registration or a hand tick already counts this guest
          !isOn(s.wallet as Address),
      )
      .map((s) => s.wallet!.toLowerCase()),
  ).size;

  if (info.phase === 0 && now < info.eventEnd)
    return (
      <GlassCard className="og-card" data-testid="attendance-early">
        <h2 className="og-h2">Attendance opens when the event ends</h2>
        <p className="og-lede">
          Deposits stay open until {when(info.eventEnd)}. Then load your check-in list here and confirm who came by{" "}
          {when(info.claimDeadline)}.
        </p>
        <Messages event={event} />
      </GlassCard>
    );
  if (info.phase === 0 && now <= info.claimDeadline && info.stakerCount === 0)
    return (
      <div className="flex flex-col gap-5" data-testid="attendance-empty">
        <h2 className="kb-h1">Attendance</h2>
        <p className="og-lede">No guest had a deposit when the event ended, so there is nothing to confirm.</p>
        <Messages event={event} />
      </div>
    );
  const listClosedTx = record.data?.listClosed?.tx;
  // the transactions that put guests on the list besides the close: each save, and each add after closing
  const saveTxs = record.data?.attendanceTxs.filter((a) => a.how === "saved") ?? [];
  const lateTxs = record.data?.attendanceTxs.filter((a) => a.how === "late") ?? [];
  if (info.phase === 2) {
    // the final record, read only: who came, who did not, and how each challenge ended
    const came = booked.filter((w) => already.has(w.toLowerCase()));
    // a guest still with Kleros is neither an attendee nor a no-show yet: a share is held for them
    const open = info.openCases;
    const noShowCount = booked.length - info.attendeeCount - open;
    const releasedTx = record.data?.released?.tx;
    // "got" only once every attendee has their share in their wallet
    const allPaid = data.unpaid.length === 0 && data.refused.length === 0;
    const n = info.attendeeCount;
    const who = `${n} ${n === 1 ? "attendee" : "attendees"}`;
    return (
      <div className="flex flex-col gap-5" data-testid="attendance-final">
        <div className="flex flex-col gap-1">
          <h2 className="kb-h1">Attendance</h2>
          <p className="og-lede">
            {allPaid && open === 0
              ? n === 1
                ? "Payouts are released and the attendee has been paid."
                : `Payouts are released and all ${who} have been paid.`
              : n === 1
                ? "Payouts are released: 1 attendee gets the deposits."
                : `Payouts are released: ${who} share the deposits.`}
          </p>
        </div>
        <Figures
          rows={[
            { label: "Deposits", value: String(booked.length) },
            { label: "Came", value: String(info.attendeeCount) },
            { label: "Did not come", value: String(Math.max(0, noShowCount)) },
            ...(open > 0 ? [{ label: "With Kleros", value: String(open) }] : []),
            {
              // a lost case's held share is split among the attendees: the share can still rise
              label: open > 0 ? "Each attendee gets so far" : allPaid ? "Each attendee got" : "Each attendee's share",
              value: assetText(info.payoutShare, info),
            },
          ]}
        />
        {(listClosedTx || releasedTx || saveTxs.length > 0 || lateTxs.length > 0) && (
          <p className="og-note flex flex-wrap gap-x-4" data-testid="attendance-txs">
            {saveTxs.map((a, i) => (
              <span key={a.tx}>
                Attendance saved{saveTxs.length > 1 ? ` (${i + 1})` : ""}:{" "}
                <TxLink tx={a.tx} testId="attendance-saved-tx" />
              </span>
            ))}
            {listClosedTx && (
              <span>
                Attendance list closed: <TxLink tx={listClosedTx} testId="list-closed-tx" />
              </span>
            )}
            {lateTxs.map((a, i) => (
              <span key={a.tx}>
                Added after closing{lateTxs.length > 1 ? ` (${i + 1})` : ""}:{" "}
                <TxLink tx={a.tx} testId="attendance-late-tx" />
              </span>
            ))}
            {releasedTx && (
              <span>
                Payouts released: <TxLink tx={releasedTx} />
              </span>
            )}
          </p>
        )}
        <div className="og-table" role="table" aria-label="Final attendance">
          {booked.map((w) => {
            const name = luma.nameOf(w);
            const challenge = data.challenges.find((c) => c.wallet.toLowerCase() === w.toLowerCase());
            const on = already.has(w.toLowerCase());
            const text = on
              ? challenge
                ? "Came (added after a challenge)"
                : "Came"
              : challenge?.state === 2
                ? "With Kleros: a share is held"
                : challenge?.state === 3
                  ? challenge.ruling === 0
                    ? "Did not come (Kleros did not rule either way)"
                    : "Did not come (challenge lost at Kleros)"
                  : "Did not come";
            return (
              <div key={w} className="og-row" data-testid="attendance-final-row" data-wallet={w.toLowerCase()}>
                <div className="og-row-main">
                  <span title={w}>
                    {name && <b className="mr-2">{name}</b>}
                    <span className="og-mono">{shortHex(w)}</span>
                  </span>
                  <span className="og-cell-status">
                    <span
                      className="og-dot"
                      data-tone={on ? "ok" : challenge?.state === 2 ? "warn" : "end"}
                      aria-hidden
                    />
                    <span>{text}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {came.length === 0 && <p className="og-note">Nobody is on the list.</p>}
      </div>
    );
  }
  if (info.phase === 3 || (info.phase === 0 && now > info.claimDeadline)) {
    const left = data.booked.length;
    const deposited = record.data
      ? [...record.data.wallets.values()].filter((w) => w.deposit).length
      : data.guests.length;
    const lead = info.phase === 3 ? "The event was cancelled" : "The deadline to confirm who came has passed";
    return (
      <div className="flex flex-col gap-5" data-testid="attendance-refunds">
        <h2 className="kb-h1">Attendance</h2>
        <p className="og-lede">
          {left > 0
            ? `${lead}: ${left === 1 ? "1 guest has" : `${left} guests have`} not withdrawn their deposit yet. They can withdraw it on the guest page, or you can send the refunds on the Payout tab.`
            : deposited > 0
              ? `${lead}, and every deposit has been returned.`
              : `${lead}. No guest had deposited, so there is nothing to return.`}
        </p>
        {left > 0 && (
          <Link
            href={paths.organiseEvent.getHref(event.address, undefined, "payout")}
            className="kb-link kb-tap self-start"
          >
            Send the refunds on the Payout tab
          </Link>
        )}
        <Messages event={event} />
      </div>
    );
  }

  const toggle = (w: Address, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(w.toLowerCase());
    else next.delete(w.toLowerCase());
    setPicked(next);
    savePicked(next);
  };
  const send = (close: boolean) => {
    const sent = first;
    setConfirm(null);
    // ticks stay as they are: only the wallets just sent leave them, once the send is confirmed
    const forget = () =>
      setPicked((prev) => {
        const next = prev && new Set([...prev].filter((w) => !sent.some((a) => a.toLowerCase() === w)));
        savePicked(next);
        return next;
      });
    if (listed) {
      event.run(
        `Add ${sent.length}`,
        () => tx.addAttendees(info.contract, sent),
        batched
          ? `${guests(sent.length)} added to the list. Send the next batch.`
          : `${guests(sent.length)} added to the list.`,
        forget,
        {
          TooLate: "The time to add guests ended before your list was sent. Nothing was recorded.",
          NotListed: "The list changed before your send. Nothing was recorded.",
        },
      );
      return;
    }
    // one transaction for a list that fits; the last batch closes it
    const closeNow = close && !batched;
    event.run(
      closeNow ? "Confirm and close" : `Save ${sent.length}`,
      () => tx.postAttendance(info.contract, sent, closeNow),
      closeNow
        ? "The list is confirmed and closed. The challenge window is open."
        : batched
          ? `${guests(sent.length)} saved. Send the next batch.`
          : `${guests(sent.length)} saved. Close the list when it is complete.`,
      forget,
      {
        TooLate: "The deadline to confirm who came passed before your list was sent. Nothing was recorded.",
        TooEarly: "The event has not ended yet, so attendance cannot be sent. Nothing was recorded.",
        NotOpen:
          "The event is no longer open for attendance (it was cancelled or the list was already closed). Nothing was recorded.",
      },
    );
  };

  // the same figure as the Payout tab and the contract's release: open cases and waiting challenges take a share
  const projected = projectedShare(info, data.challenges, toAdd);
  const counted = projected.waiting + info.openCases;
  const challengeOf = new Map(data.challenges.map((c) => [c.wallet.toLowerCase(), c]));
  // nothing loaded and the list not closed: nobody has been called a no-show yet
  const undecided = !listed && !csv;
  // the contract refuses an empty list: say what to do, and the way out when nobody came
  const emptyGate = gate(
    !listed && canAdd && total === 0
      ? "Tick at least one guest who came. If nobody came, cancel the event on the Overview tab: every guest can then withdraw their full deposit on the guest page."
      : null,
  );

  return (
    <div className="flex flex-col gap-5" data-testid="attendance">
      <div className="flex flex-col gap-1">
        <h2 className="kb-h1">Attendance</h2>
        <p className="og-lede">
          {listed
            ? now > info.challengeEndsAt
              ? data.challenges.some((c) => c.state === 1 || c.state === 2)
                ? `The time to add guests ended on ${when(info.challengeEndsAt)}. Guests who challenged can still be added, by a Kleros ruling or when payouts are released. See the Payout tab.`
                : `The list is final: the time to add guests ended on ${when(info.challengeEndsAt)}. Release payouts on the Payout tab.`
              : `The list is closed. Until ${when(info.challengeEndsAt)}, you can still add guests left off by mistake.`
            : `Load the Luma export: everyone who checked in is ticked. Review the ticks, then confirm the list by ${when(info.claimDeadline)}. Once it is confirmed, guests cannot be removed, and guests left off have ${spanText(info.challengePeriod)} to challenge.`}
        </p>
        {(saveTxs.length > 0 || (listed && listClosedTx) || lateTxs.length > 0) && (
          <p className="og-note flex flex-wrap gap-x-4" data-testid="attendance-txs">
            {saveTxs.map((a, i) => (
              <span key={a.tx}>
                Attendance saved{saveTxs.length > 1 ? ` (${i + 1})` : ""}:{" "}
                <TxLink tx={a.tx} testId="attendance-saved-tx" />
              </span>
            ))}
            {listed && listClosedTx && (
              <span>
                Attendance list closed: <TxLink tx={listClosedTx} testId="list-closed-tx" />
              </span>
            )}
            {lateTxs.map((a, i) => (
              <span key={a.tx}>
                Added after closing{lateTxs.length > 1 ? ` (${i + 1})` : ""}:{" "}
                <TxLink tx={a.tx} testId="attendance-late-tx" />
              </span>
            ))}
          </p>
        )}
      </div>
      {!listed && event.isOwner && (
        <FilePick
          label="Load the check-in list"
          hint="A Luma guest export, or any CSV with a wallet column"
          file={csv && plan ? { name: csv.name, rows: plan.attending.length + plan.skipped.length } : null}
          onFile={(name, text) => {
            let rows: ReturnType<typeof matchLuma>;
            try {
              attendanceFromCsv(text, booked);
              rows = matchLuma(text, booked);
            } catch {
              // keep the list already loaded
              setErr({ text: CSV_ERROR, at: Date.now() });
              return;
            }
            setErr(null);
            const at = Date.now();
            setCsv({ name, text, at });
            setPicked(null);
            // kept in this browser for this event (a new file clears the ticks saved with the last one)
            writeCheckin(event.address, { name, text, at });
            luma.add(rows);
          }}
          testId="checkin-csv"
        />
      )}
      {!listed && event.isOwner && csv && (
        <p className="og-note" data-testid="checkin-loaded">
          {csv.at ? `Loaded ${when(Math.floor(csv.at / 1000))}. ` : ""}
          <Button
            className="kb-link kb-tap"
            onPress={() => {
              forgetCheckin(event.address);
              setCsv(null);
              setPicked(null);
            }}
          >
            Forget this list
          </Button>
        </p>
      )}
      {!listed && event.isOwner && <ErrorLine error={err} />}
      {event.isOwner && plan && plan.skipped.length > 0 && (
        <details className="og-skipped" open>
          <summary>
            {`${plan.skipped.length} ${plan.skipped.length === 1 ? "row" : "rows"} not used`}
            {unscanned > 0 &&
              (listed
                ? ` · ${guests(unscanned)} deposited but did not check in. Add any you saw at the door before ${when(info.challengeEndsAt)}, or they may challenge.`
                : ` · ${guests(unscanned)} deposited but did not check in. Tick any you saw at the door, or they may challenge.`)}
          </summary>
          <ul>
            {plan.skipped.map((s) => (
              <li key={s.row}>
                Spreadsheet row {s.row}
                {s.name ? ` · ${s.name}` : ""} · {SKIP_TEXT[s.reason]}
                {s.wallet && (
                  <>
                    {" · "}
                    <span className="og-mono whitespace-nowrap">{shortHex(s.wallet)}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Figures
        big
        rows={[
          { label: "Deposits", value: String(booked.length) },
          { label: "On the list", value: String(total) },
          { label: undecided ? "Not ticked" : "No-shows", value: String(noShows) },
          ...(challenging > 0 ? [{ label: "Challenging", value: String(challenging) }] : []),
          {
            label: "Each attendee gets",
            value: projected.share === null ? "—" : assetText(projected.share, info),
            note:
              counted > 0
                ? `Counts ${counted} open ${counted === 1 ? "challenge" : "challenges"}; can change until payouts are released`
                : undefined,
          },
        ]}
      />
      <div className="og-table" role="table" aria-label="Guests with deposits">
        <div className="og-thead" role="row">
          <span>Guest</span>
          <span />
          <span />
          <span>Status</span>
          <span className="text-right">Came</span>
        </div>
        {booked.map((w) => {
          const on = already.has(w.toLowerCase());
          const withKleros = !on && inCase.has(w.toLowerCase());
          // a challenge still waiting for the organiser's answer
          const ch = challengeOf.get(w.toLowerCase());
          const challenged = !on && ch?.state === 1;
          const challengedText = !challenged
            ? ""
            : now <= ch.matchEndsAt
              ? canAdd
                ? "Challenged · add them or answer on the Payout tab"
                : "Challenged · answer on the Payout tab"
              : "Challenged · added when payouts are released";
          return (
            <div key={w} className="og-row" data-testid="attendance-row">
              <div className="og-row-main">
                <span className="og-cell-wallet" title={w}>
                  {luma.nameOf(w) && <span className="og-cell-name">{luma.nameOf(w)}</span>}
                  <span className="og-mono">{shortHex(w)}</span>
                </span>
                <span className="og-cell-hide" />
                <span className="og-cell-hide" />
                <span className="og-cell-status">
                  <span className="og-dot" data-tone={withKleros ? "end" : isOn(w) ? "ok" : "warn"} aria-hidden />
                  <span>
                    {withKleros
                      ? "With Kleros"
                      : challenged && !isOn(w)
                        ? challengedText
                        : on
                          ? "Already on the list"
                          : isOn(w)
                            ? csv
                              ? "Came (from Luma)"
                              : "Came"
                            : listed
                              ? "Not on the list"
                              : csv
                                ? "Did not come"
                                : "Not ticked"}
                  </span>
                </span>
                <span className="og-ticks">
                  <label className="og-tick">
                    <input
                      type="checkbox"
                      checked={isOn(w)}
                      disabled={on || withKleros || !canAdd}
                      aria-label={`${w} came`}
                      onChange={(e) => toggle(w, e.currentTarget.checked)}
                    />
                    <span className="md:sr-only">Came</span>
                  </label>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {picked && (
        <Button
          className="kb-link self-start"
          onPress={() => {
            setPicked(null);
            savePicked(null);
          }}
        >
          Reset ticks
        </Button>
      )}
      <Messages event={event} />
      {!listed && (
        <p className="og-note">
          {batched
            ? `Your list has more than ${BATCH_SIZE} guests, so it is saved in batches of ${BATCH_SIZE}, one transaction each. Saved wallets cannot be removed later. When only the last batch is left, “Confirm and close” saves it, closes the list and starts the challenge window.`
            : "“Save for now” records these wallets on the blockchain: they cannot be removed later, but you can keep adding. “Confirm and close” is final and starts the challenge window. Each is one transaction from your wallet."}
        </p>
      )}
      {!(listed && toAdd.length === 0) && (
        <GlassCard className="og-selbar og-thumb">
          <span className="og-note">{`${undecided ? `${total} ticked · ${noShows} not ticked` : `${total} came · ${noShows} ${noShows === 1 ? "no-show" : "no-shows"}`}${challenging > 0 ? ` · ${challenging} challenging` : ""}`}</span>
          <div className="og-actions">
            {listed ? (
              <GradientButton isDisabled={!canAdd || !toAdd.length} onPress={() => setConfirm("save")}>
                {batched
                  ? `Add ${first.length} of ${toAdd.length} first`
                  : toAdd.length
                    ? `Add ${toAdd.length} to the list`
                    : "Add to the list"}
              </GradientButton>
            ) : (
              <>
                {!batched && (
                  <GradientButton
                    className="is-quiet"
                    isDisabled={!canAdd || !toAdd.length}
                    onPress={() => setConfirm("save")}
                  >
                    {toAdd.length ? `Save ${toAdd.length} for now` : "Save for now"}
                  </GradientButton>
                )}
                <GradientButton
                  isDisabled={!canAdd || total === 0}
                  aria-describedby={emptyGate.enabled ? undefined : emptyId}
                  onPress={() => setConfirm(batched ? "save" : "close")}
                >
                  {batched ? `Save ${first.length} of ${toAdd.length} first` : "Confirm and close"}
                </GradientButton>
                <Locked gate={emptyGate} id={emptyId} />
              </>
            )}
          </div>
        </GlassCard>
      )}
      {confirm && canAdd && (
        <ConfirmDialog
          isOpen
          title={
            final
              ? "Confirm and close the list"
              : listed
                ? "Add to the list"
                : batched
                  ? "Save the first batch"
                  : "Save for now"
          }
          intro={
            final
              ? "Guests left off can then challenge. The no-shows' deposits are split among the guests on the list."
              : batched
                ? `The first ${first.length} of ${toAdd.length} guests will be ${listed ? "added" : "saved"}. Send the rest next${listed ? "." : ", then close the list."}`
                : listed
                  ? `These guests will be added to the attendance list. You can add more until ${when(info.challengeEndsAt)}.`
                  : "These guests will be added to the attendance list. You can keep adding until you close it."
          }
          words={final ? [TYPED_WORDS.close] : []}
          figures={[
            { label: "Adding now", value: String(first.length) },
            { label: "On the list after", value: String(afterSend) },
            { label: "No-shows", value: String(booked.length - afterSend - challengingAfter) },
            ...(challengingAfter > 0 ? [{ label: "Challenging", value: String(challengingAfter) }] : []),
          ]}
          action={final ? "Confirm and close" : listed ? `Add ${first.length}` : `Save ${first.length}`}
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(null)}
          onConfirm={() => send(final)}
        />
      )}
    </div>
  );
}
