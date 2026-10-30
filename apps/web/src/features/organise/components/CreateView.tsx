"use client";

import Link from "next/link";

import { TZ_OFFSETS } from "@kickback/core";

import { CopyButton } from "@/components/ui/CopyButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { CheckIcon } from "@/components/ui/icons";

import { paths } from "@/config/paths";

import { BrowserEvents } from "./BrowserEvents";
import { ConfirmDialog, ErrorLine, Primary } from "./parts";
import { useCreateScreen, type CreateFormValues, type CreateScreenModel } from "../hooks/useCreateScreen";
import { caseView, shortHex } from "../model/view";

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "datetime-local" | "number" | "url" | "select";
  options?: readonly string[];
  hint?: string;
  full?: boolean;
  inputMode?: "decimal" | "numeric";
}

/** The create form's fields, in order. Later fields (description, cover, links) are appended here. */
export const CREATE_FIELDS: readonly FieldSpec[] = [
  { name: "title", label: "Title", full: true },
  { name: "shortName", label: "Short name", hint: "Shown to guests and in the contract" },
  { name: "venue", label: "Venue" },
  { name: "start", label: "Starts", type: "datetime-local" },
  { name: "end", label: "Ends", type: "datetime-local" },
  { name: "timezoneOffset", label: "Time zone offset", type: "select", options: TZ_OFFSETS },
  { name: "zoneName", label: "Time zone name", hint: "Such as IST or CET" },
  { name: "hosts", label: "Hosts" },
  { name: "registrationLink", label: "Registration link", type: "url", hint: "The Luma page" },
  { name: "deposit", label: "Deposit, ETH", inputMode: "decimal" },
  { name: "settleDays", label: "Settle within, days", type: "number", hint: "7 to 365; guests can withdraw after" },
];

export function CreateForm({
  fields = CREATE_FIELDS,
  values,
  errors,
  onChange,
  disabled,
}: {
  fields?: readonly FieldSpec[];
  values: CreateFormValues;
  errors: Record<string, string>;
  onChange: (name: string, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="og-form" data-testid="create-form">
      {fields.map((field) => {
        const id = `create-${field.name}`;
        const error = errors[field.name];
        const common = {
          id,
          name: field.name,
          className: "og-input",
          value: values[field.name] ?? "",
          disabled,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error || field.hint ? `${id}-note` : undefined,
        } as const;
        return (
          <div key={field.name} className={field.full ? "og-field is-full" : "og-field"}>
            <label className="og-label" htmlFor={id}>
              {field.label}
            </label>
            {field.type === "select" ? (
              <select {...common} onChange={(event) => onChange(field.name, event.currentTarget.value)}>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    UTC{option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...common}
                type={field.type === "url" ? "url" : field.type === "number" ? "number" : (field.type ?? "text")}
                inputMode={field.inputMode}
                onChange={(event) => onChange(field.name, event.currentTarget.value)}
              />
            )}
            {(error || field.hint) && (
              <span id={`${id}-note`} className={error ? "og-err" : "og-note"}>
                {error ?? field.hint}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function JurorsPreview({
  text,
  policyURI,
  pinned,
}: {
  text: string | null;
  policyURI: string;
  pinned: boolean;
}) {
  return (
    <GlassCard as="section" className="og-card" data-testid="jurors-preview">
      <h2 className="og-h2">What jurors will read</h2>
      {text ? (
        <div className="og-preview" data-testid="case-text">
          {caseView(text).map((part, i) =>
            i === 0 ? (
              <p key={i} className="og-case-q">
                {part}
              </p>
            ) : (
              <p key={i}>{part}</p>
            ),
          )}
        </div>
      ) : (
        <p className="og-note">Fill in the form to see the case jurors would read about a challenged guest.</p>
      )}
      <p className="og-note">
        Policy: the generic Kickback policy, {pinned ? "pinned" : "pinned on deploy"} at{" "}
        <span className="og-mono">{shortHex(policyURI.replace("/ipfs/", ""), 4)}</span>
      </p>
    </GlassCard>
  );
}

const LUMA_SETUP = [
  "Add a registration question: deposit transaction link",
  "Add a registration question: wallet address",
  "Put the guest link in the event description",
];

export function DeployedPanel({ model }: { model: CreateScreenModel }) {
  const done = model.deployed!;
  return (
    <div className="flex flex-col gap-6" data-testid="deployed">
      <p className="og-success" role="status">
        <CheckIcon size={20} />
        <span>
          <strong>Deployed.</strong> Your event is live at <span className="og-mono">{shortHex(done.address)}</span>.
        </span>
      </p>
      <GlassCard className="og-card">
        <div className="og-link-row">
          <span className="og-label">Organiser link</span>
          <span className="og-mono" data-testid="admin-link">
            {done.adminLink}
          </span>
          <CopyButton value={done.adminLink} label="Copy organiser link" />
        </div>
        <div className="og-link-row">
          <span className="og-label">Guest link</span>
          <span className="og-mono" data-testid="guest-link">
            {done.guestLink}
          </span>
          <CopyButton value={done.guestLink} label="Copy guest link" />
        </div>
        <div className="og-actions">
          <Link
            className="kb-btn"
            href={paths.organiseEvent.getHref(done.address, done.block)}
            data-testid="open-event"
          >
            Open the event
          </Link>
          <a className="kb-link" href={done.guestLink} data-testid="open-guest">
            View the guest page
          </a>
        </div>
      </GlassCard>
      <section className="flex flex-col gap-2">
        <h2 className="og-h2">Set up Luma</h2>
        <ol className="og-steps">
          {LUMA_SETUP.map((step, i) => (
            <li key={step} className="og-step">
              <span className="og-step-n">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function CreateView({ model }: { model: CreateScreenModel }) {
  const working = model.step === "pinning" || model.step === "deploying";
  const label = model.step === "pinning" ? "Pinning the policy…" : model.step === "deploying" ? "Deploying…" : "Deploy";
  return (
    <div className="og-page" data-testid="create">
      <div className="og-head">
        <Link href={paths.organise.getHref()} className="kb-link text-sm">
          ← Events
        </Link>
        <h1 className="kb-h1">New event</h1>
      </div>
      <div className="og-create">
        <div className="flex flex-col gap-6">
          {model.deployed ? (
            <DeployedPanel model={model} />
          ) : (
            <>
              {model.notSetUp && (
                <p className="og-err" role="alert" data-testid="not-set-up">
                  {model.notSetUp}
                </p>
              )}
              <GlassCard className="og-card">
                <CreateForm values={model.form} errors={model.errors} onChange={model.setField} disabled={working} />
              </GlassCard>
              <div className="flex flex-col gap-2">
                <Primary gate={model.deployGate} onPress={model.deploy} pending={working} busy={model.busy}>
                  {label}
                </Primary>
                <p className="og-note">Pins the policy, then asks your wallet once.</p>
              </div>
              <ErrorLine error={model.error} />
            </>
          )}
          <BrowserEvents events={model.previous} />
        </div>
        <div className="og-aside">
          <JurorsPreview text={model.preview} policyURI={model.policyURI} pinned={model.policyPinned} />
        </div>
      </div>
      {model.askNew && (
        <ConfirmDialog
          isOpen
          title="Create another event"
          intro="This browser already created an event. Type NEW to deploy a separate one."
          figures={[]}
          words={[model.newWord]}
          action="Deploy"
          busy={working}
          error={model.error?.text ?? null}
          onClose={model.closeNew}
          onConfirm={(typed) => model.confirmNew(typed[0] ?? "")}
        />
      )}
    </div>
  );
}

export function CreateScreen() {
  const model = useCreateScreen();
  return <CreateView model={model} />;
}
