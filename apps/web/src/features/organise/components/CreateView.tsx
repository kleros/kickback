"use client";

import Link from "next/link";

import { TZ_OFFSETS } from "@kickback/core";

import { EventDetailsView } from "@/components/EventDetailsView";
import { CopyButton } from "@/components/ui/CopyButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { CheckIcon } from "@/components/ui/icons";

import { paths } from "@/config/paths";

import { BrowserEvents } from "./BrowserEvents";
import { ConfirmDialog, ErrorLine, Primary } from "./parts";
import { useCreateScreen, type CreateFormValues, type CreateScreenModel } from "../hooks/useCreateScreen";
import { createSharePreview } from "../model/sharePreview";
import { caseView, ethText, shortHex } from "../model/view";

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "datetime-local" | "number" | "url" | "select" | "textarea" | "file";
  options?: readonly string[];
  hint?: string;
  full?: boolean;
  inputMode?: "decimal" | "numeric";
}

export const CREATE_FIELDS: readonly FieldSpec[] = [
  { name: "title", label: "Title", full: true },
  {
    name: "description",
    label: "Description",
    type: "textarea",
    full: true,
    hint: "Plain text, up to 1200 characters",
  },
  { name: "cover", label: "Cover image", type: "file", full: true, hint: "PNG, JPEG or WebP, up to 2 MB" },
  {
    name: "links",
    label: "Extra links",
    type: "textarea",
    full: true,
    hint: "Up to 3 lines: Label | https://example.com",
  },
  {
    name: "share",
    label: "Share template",
    type: "textarea",
    full: true,
    hint: "Optional. Up to 280 characters after filling. Use {event}, {date}, {venue}, {luma}, {guestLink}.",
  },
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
  onCover,
  disabled,
}: {
  fields?: readonly FieldSpec[];
  values: CreateFormValues;
  errors: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onCover?: (file?: File) => void;
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
            {field.type === "file" ? (
              <input
                {...common}
                value={undefined}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => onCover?.(event.currentTarget.files?.[0])}
              />
            ) : field.type === "textarea" ? (
              <textarea {...common} rows={4} onChange={(event) => onChange(field.name, event.currentTarget.value)} />
            ) : field.type === "select" ? (
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
            {field.name === "share" && (
              <div
                className="og-note"
                aria-live="polite"
                data-testid="share-preview"
                style={{ overflowWrap: "anywhere" }}
              >
                <strong>Share preview</strong>
                <p>{createSharePreview(values)}</p>
                <p>The guest link is available after deployment.</p>
              </div>
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
      {text && (
        <p className="og-note">
          Guest: example wallet. Contract: example address. When disconnected, the organiser is also an example wallet.
        </p>
      )}
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
                <CreateForm
                  values={model.form}
                  errors={model.errors}
                  onChange={model.setField}
                  onCover={model.setCover}
                  disabled={working}
                />
              </GlassCard>
              <div className="flex flex-col gap-2">
                <Primary gate={model.deployGate} onPress={model.deploy} pending={working} busy={model.busy}>
                  {label}
                </Primary>
                <p className="og-note">Pins the policy and event details, then asks your wallet once.</p>
              </div>
              <ErrorLine error={model.error} />
            </>
          )}
          <BrowserEvents events={model.previous} />
        </div>
        <div className="og-aside">
          <JurorsPreview text={model.preview} policyURI={model.policyURI} pinned={model.policyPinned} />
          <div aria-label="Guest page preview">
            <h2 className="og-h2">Guest page preview</h2>
            <EventDetailsView
              details={{
                title: model.form.title || null,
                name: null,
                when: model.form.start || null,
                where: model.form.venue || null,
                hosts: (model.form.hosts ?? "").split(/,\s*|\s+and\s+/).filter(Boolean),
                link: model.form.registrationLink || null,
                infoPath: null,
              }}
              description={model.form.description ?? ""}
              coverUrl={model.coverUrl}
              links={model.detailLinks ?? []}
            />
          </div>
        </div>
      </div>
      {model.frozen && (
        <ConfirmDialog
          isOpen
          title="Deploy event"
          intro="These are the event details you sign."
          figures={[
            { label: "Event name", value: model.frozen.eventName },
            { label: "Deposit", value: ethText(model.frozen.deposit) },
            { label: "Start", value: new Date(model.frozen.start * 1000).toISOString() },
            { label: "Deadline", value: new Date(model.frozen.deadline * 1000).toISOString() },
            {
              label: "Owner",
              value: (
                <span className="og-mono" style={{ overflowWrap: "anywhere" }}>
                  {model.frozen.owner}
                </span>
              ),
            },
          ]}
          words={[]}
          action="Deploy"
          busy={working || model.busy}
          error={model.error?.text ?? null}
          onClose={model.close}
          onConfirm={() => void model.confirm()}
        />
      )}
    </div>
  );
}

export function CreateScreen() {
  const model = useCreateScreen();
  return <CreateView model={model} />;
}
