"use client";

import { useMemo, useState } from "react";

import { attendanceFromCsv, batches, BATCH_SIZE } from "@kickback/core";
import { Button } from "react-aria-components";
import type { Address } from "viem";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { Messages } from "./Messages";
import { ConfirmDialog, FilePick, Figures } from "./parts";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { assetText, shortHex, TYPED_WORDS } from "../model/view";
import { tx } from "../operations/tx";

const SKIP_TEXT = {
  "no-wallet": "No wallet in the row",
  "not-a-guest": "Wallet has no deposit",
  "not-checked-in": "Not checked in",
  duplicate: "Listed twice",
} as const;

const when = (unix: number) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(unix * 1000));

export function AttendanceScreen() {
  const event = useOrganiserEvent();
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [confirm, setConfirm] = useState<"close" | "save" | null>(null);
  const data = event.overview.data;
  const booked = useMemo(() => data?.booked ?? [], [data]);
  const plan = useMemo(() => (csv ? attendanceFromCsv(csv.text, booked) : null), [csv, booked]);
  if (!data) return <p className="og-note">Reading the event…</p>;
  const info = data.event;
  const already = new Set(data.attendees.map((a) => a.toLowerCase()));
  // the organiser's ticks start from the CSV's check-ins, or from who is already on the list
  const chosen = picked ?? new Set((plan?.attending ?? []).map((a) => a.toLowerCase()));
  const isOn = (w: Address) => already.has(w.toLowerCase()) || chosen.has(w.toLowerCase());
  const toAdd = booked.filter((w) => !already.has(w.toLowerCase()) && chosen.has(w.toLowerCase()));
  const listed = info.phase === 1;
  const inWindow = info.phase === 0 && data.now >= info.eventEnd && data.now <= info.claimDeadline;
  const canAdd = event.isOwner && !event.busy && (inWindow || (listed && data.now <= info.challengeEndsAt));
  const total = booked.filter(isOn).length;
  const noShows = booked.length - total;

  if (info.phase === 0 && data.now < info.eventEnd)
    return (
      <GlassCard className="og-card" data-testid="attendance-early">
        <h2 className="og-h2">Attendance opens when the event ends</h2>
        <p className="og-lede">
          Bookings stay open until {when(info.eventEnd)}. Then load your check-in list here and post who came, by{" "}
          {when(info.claimDeadline)}.
        </p>
      </GlassCard>
    );
  if (info.phase === 2 || info.phase === 3 || (info.phase === 0 && data.now > info.claimDeadline))
    return (
      <div className="flex flex-col gap-5">
        <h2 className="kb-h1">Attendance</h2>
        <p className="og-lede">
          {info.phase === 2
            ? `${info.attendeeCount} attendees were paid out.`
            : info.phase === 3
              ? "The event was cancelled."
              : "The deadline for the list has passed: guests can withdraw their deposits."}
        </p>
      </div>
    );

  const toggle = (w: Address, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(w.toLowerCase());
    else next.delete(w.toLowerCase());
    setPicked(next);
  };
  const send = (close: boolean) => {
    const list = toAdd;
    setConfirm(null);
    setPicked(null);
    if (listed) {
      event.run(`Add ${list.length}`, () => tx.addAttendees(info.contract, list), `${list.length} added to the list.`);
      return;
    }
    const parts = batches(list, BATCH_SIZE);
    // one transaction for a list that fits; the last batch closes it
    const first = parts[0] ?? [];
    const closeNow = close && parts.length <= 1;
    event.run(
      closeNow ? "Post and close" : `Post ${first.length}`,
      () => tx.postAttendance(info.contract, first, closeNow),
      closeNow
        ? "The list is posted and closed. The challenge window is open."
        : parts.length > 1
          ? `${first.length} posted. Send the next batch.`
          : `${first.length} names saved. Close the list when it is complete.`,
    );
  };

  return (
    <div className="flex flex-col gap-5" data-testid="attendance">
      <div className="flex flex-col gap-1">
        <h2 className="kb-h1">Attendance</h2>
        <p className="og-lede">
          {listed
            ? `The list is closed. Until ${when(info.challengeEndsAt)} you can still add guests left off by mistake.`
            : `Tick who came, then post the list by ${when(info.claimDeadline)}. Closing it opens a ${Math.round(info.challengePeriod / 3600)} hour window for challenges.`}
        </p>
      </div>
      {!listed && (
        <FilePick
          label="Load the check-in list"
          hint="A Luma guest export, or any CSV with a wallet column"
          file={csv && plan ? { name: csv.name, rows: plan.attending.length + plan.skipped.length } : null}
          onFile={(name, text) => {
            setCsv({ name, text });
            setPicked(null);
          }}
          testId="checkin-csv"
        />
      )}
      {plan && plan.skipped.length > 0 && (
        <details className="og-note">
          <summary>{plan.skipped.length} rows not used</summary>
          <ul>
            {plan.skipped.map((s) => (
              <li key={s.row}>
                Row {s.row} · {s.name} · {SKIP_TEXT[s.reason]}
                {s.wallet ? ` · ${shortHex(s.wallet)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Figures
        rows={[
          { label: "Booked", value: String(booked.length) },
          { label: "On the list", value: String(total) },
          { label: "No-shows", value: String(noShows) },
          {
            label: "Each attendee gets",
            value: total ? assetText((info.depositAmount * BigInt(booked.length)) / BigInt(total), info) : "—",
          },
        ]}
      />
      <div className="og-table" role="table" aria-label="Booked guests">
        <div className="og-thead" role="row">
          <span>Wallet</span>
          <span />
          <span />
          <span>Status</span>
          <span>Came</span>
        </div>
        {booked.map((w) => {
          const on = already.has(w.toLowerCase());
          return (
            <div key={w} className="og-row" data-testid="attendance-row">
              <div className="og-row-main">
                <span className="og-cell-wallet og-mono" title={w}>
                  {shortHex(w)}
                </span>
                <span className="og-cell-hide" />
                <span className="og-cell-hide" />
                <span className="og-cell-status">
                  <span className="og-dot" data-tone={isOn(w) ? "ok" : "warn"} aria-hidden />
                  <span>{on ? "On the list" : isOn(w) ? "To add" : "Not on the list"}</span>
                </span>
                <span className="og-ticks">
                  <label className="og-tick">
                    <input
                      type="checkbox"
                      checked={isOn(w)}
                      disabled={on || !canAdd}
                      aria-label={`${w} came`}
                      onChange={(e) => toggle(w, e.currentTarget.checked)}
                    />
                    <span>Came</span>
                  </label>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {picked && (
        <Button className="kb-link self-start" onPress={() => setPicked(null)}>
          Reset ticks
        </Button>
      )}
      <Messages event={event} />
      <GlassCard className="og-selbar og-thumb">
        <span className="og-note">{toAdd.length} to add</span>
        <div className="og-actions">
          {listed ? (
            <GradientButton isDisabled={!canAdd || !toAdd.length} onPress={() => setConfirm("save")}>
              {`Add ${toAdd.length} to the list`}
            </GradientButton>
          ) : (
            <>
              <GradientButton
                className="is-quiet"
                isDisabled={!canAdd || !toAdd.length}
                onPress={() => setConfirm("save")}
              >
                {`Save ${toAdd.length}, keep open`}
              </GradientButton>
              <GradientButton isDisabled={!canAdd || total === 0} onPress={() => setConfirm("close")}>
                Post and close the list
              </GradientButton>
            </>
          )}
        </div>
      </GlassCard>
      {confirm && (
        <ConfirmDialog
          isOpen
          title={confirm === "close" ? "Post and close the list" : listed ? "Add to the list" : "Save names"}
          intro={
            confirm === "close"
              ? "Guests left off can then challenge. The pool is split among the guests on the list."
              : "These wallets are added to the attendance list."
          }
          words={confirm === "close" ? [TYPED_WORDS.post] : []}
          figures={[
            { label: "Adding now", value: String(toAdd.length) },
            { label: "On the list after", value: String(total) },
            { label: "No-shows", value: String(noShows) },
          ]}
          action={confirm === "close" ? "Post and close" : `Add ${toAdd.length}`}
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(null)}
          onConfirm={() => send(confirm === "close")}
        />
      )}
    </div>
  );
}
