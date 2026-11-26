"use client";

import { useId, useRef, useState, type ReactNode } from "react";

import { Button } from "react-aria-components";

import { Dialog } from "@/components/ui/Dialog";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";
import { FileIcon, LockIcon } from "@/components/ui/icons";

import { DEFAULT_CHAIN } from "@/config/chains";

import type { Phase } from "../model/phase";
import type { Gate } from "../model/shared";
import { PHASE_TONE, shortHex } from "../model/view";

export function PhasePill({ phase }: { phase: Phase }) {
  return (
    <span className="og-phase" data-tone={PHASE_TONE[phase]} data-testid="phase">
      {phase}
    </span>
  );
}

export interface Figure {
  label: string;
  value: ReactNode;
  note?: string;
}

export function Figures({ rows, big, testId }: { rows: readonly Figure[]; big?: boolean; testId?: string }) {
  return (
    <dl className={big ? "og-figs og-fig-big" : "og-figs"} data-testid={testId}>
      {rows.map((row) => (
        <div key={row.label} className={big ? "og-fig og-fig-big" : "og-fig"}>
          <dt>{row.label}</dt>
          <dd className="kb-num">
            {row.value}
            {row.note && <span className="og-note">{row.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Why a control is locked, said beside it. */
export function Locked({ gate, id }: { gate: Gate; id?: string }) {
  if (gate.enabled || !gate.lockedReason) return null;
  return (
    <span className="og-locked" id={id} data-testid="locked">
      <LockIcon />
      {gate.lockedReason}
    </span>
  );
}

/** The route's one primary, with its locked reason beside it. */
export function Primary({
  gate,
  children,
  onPress,
  pending,
  busy,
}: {
  gate: Gate;
  children: string;
  onPress: () => void;
  pending?: boolean;
  busy?: boolean;
}) {
  const id = useId();
  return (
    <div className="og-actions">
      <GradientButton
        isDisabled={!gate.enabled || busy}
        isPending={pending}
        glyph={pending ? "arc" : undefined}
        aria-describedby={gate.enabled ? undefined : id}
        onPress={onPress}
      >
        {children}
      </GradientButton>
      <Locked gate={gate} id={id} />
    </div>
  );
}

/** Shown for any CSV the parser cannot read: never the parser's own message, which can quote raw cells. */
export const CSV_ERROR =
  "This file could not be read as a CSV. Export the guest list from Luma again and choose that file.";

export function ErrorLine({ error }: { error: { text: string; at: number } | string | null }) {
  if (!error) return null;
  const text = typeof error === "string" ? error : error.text;
  const at = typeof error === "string" ? text : error.at;
  return (
    <p key={at} className="og-err" role="alert" data-shake="" data-testid="error">
      {text}
    </p>
  );
}

/** Picks a CSV and hands its text up; reading the file is the only thing it does. */
export function FilePick({
  label,
  file,
  onFile,
  testId,
  hint,
}: {
  label: string;
  file: { name: string; rows: number } | null;
  onFile: (name: string, text: string) => void;
  testId: string;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <GlassCard className="og-file">
      <FileIcon />
      <div className="og-file-text">
        <span className="og-file-name">{file ? file.name : label}</span>
        <span className="og-note">
          {file ? `${file.rows} ${file.rows === 1 ? "row" : "rows"}` : (hint ?? "A CSV file")}
        </span>
      </div>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        data-testid={testId}
        onChange={(event) => {
          const picked = event.currentTarget.files?.[0];
          if (picked) void picked.text().then((text) => onFile(picked.name, text));
          event.currentTarget.value = "";
        }}
      />
      <Button className="kb-link" onPress={() => input.current?.click()}>
        {file ? "Replace" : "Choose"}
      </Button>
    </GlassCard>
  );
}

type ConfirmProps = {
  title: string;
  intro: string;
  figures: readonly Figure[];
  words: readonly string[];
  action: string;
  isOpen: boolean;
  busy: boolean;
  error: string | null;
  gate?: Gate | null;
  onClose: () => void;
  onConfirm: (typed: string[]) => void;
  extra?: ReactNode;
};

/**
 * A confirm that shows the frozen figures and asks for typed words; it cannot be dismissed while busy.
 * `extra` holds fields the action needs, such as an amount.
 */
export function ConfirmDialog(props: ConfirmProps) {
  return (
    <Dialog
      isOpen={props.isOpen}
      isBusy={props.busy}
      title={props.title}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <ConfirmForm {...props} />
    </Dialog>
  );
}

function ConfirmForm({ intro, figures, words, action, busy, error, gate, onConfirm, extra }: ConfirmProps) {
  const [typed, setTyped] = useState<string[]>([]);
  const ready = words.every((word, i) => (typed[i] ?? "").trim() === word) && (!gate || gate.enabled);
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="confirm"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) onConfirm(words.map((_, i) => (typed[i] ?? "").trim()));
      }}
    >
      <p className="og-note">{intro}</p>
      {figures.length > 0 && <Figures rows={figures} testId="frozen" />}
      {extra}
      {words.map((word, i) => (
        <label key={word} className="og-field">
          <span className="og-label">Type {word} to confirm</span>
          <input
            className="og-input og-confirm-input"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            value={typed[i] ?? ""}
            onChange={(event) => {
              const next = [...typed];
              next[i] = event.currentTarget.value;
              setTyped(next);
            }}
          />
        </label>
      ))}
      {gate && <Locked gate={gate} />}
      <ErrorLine error={error} />
      <div className="og-actions justify-end">
        <GradientButton type="submit" isDisabled={!ready || busy} isPending={busy} glyph={busy ? "arc" : undefined}>
          {busy ? "Confirming…" : action}
        </GradientButton>
      </div>
    </form>
  );
}

/** A transaction, short: an explorer link when the chain has one, else the short hash. */
export function TxLink({ tx, testId }: { tx: string; testId?: string }) {
  const explorer = DEFAULT_CHAIN.blockExplorers?.default.url;
  return explorer ? (
    <a
      className="kb-link og-mono"
      href={`${explorer}/tx/${tx}`}
      target="_blank"
      rel="noreferrer"
      title={tx}
      data-testid={testId}
    >
      {shortHex(tx)} ↗
    </a>
  ) : (
    <span className="og-mono" title={tx} data-testid={testId}>
      {shortHex(tx)}
    </span>
  );
}
