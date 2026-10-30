"use client";

import { DownloadIcon } from "@/components/ui/icons";

import { ConfirmDialog, ErrorLine, FilePick, Figures, Primary } from "./parts";
import { useAttendanceScreen, type AttendanceScreenModel } from "../hooks/useAttendanceScreen";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { ethText, TYPED_WORDS } from "../model/view";

const href = (text: string, type: string) => `data:${type};charset=utf-8,${encodeURIComponent(text)}`;

export function AttendanceView({ model, posted }: { model: AttendanceScreenModel; posted: boolean }) {
  const f = model.figures;
  const frozen = model.frozen;
  return (
    <div className="flex flex-col gap-5" data-testid="attendance">
      <h2 className="kb-h1">Attendance</h2>
      {posted ? (
        <p className="og-success" role="status" data-testid="posted">
          The attendance list is posted. Payouts open once the challenge window closes.
        </p>
      ) : (
        <>
          <FilePick
            label="Load the Luma check-in export"
            hint="The guest CSV from Luma after the event"
            file={model.checkin}
            onFile={model.loadCheckin}
            testId="checkin-csv"
          />
          <FilePick
            label="Add a door list (optional)"
            hint="A CSV with a wallet or email column"
            file={model.door}
            onFile={model.loadDoor}
            testId="door-csv"
          />
        </>
      )}
      {model.building && <p className="og-note">Building the list…</p>}
      <ErrorLine error={model.buildError} />
      {f && !posted && (
        <>
          <Figures
            testId="attendance-figures"
            rows={[
              { label: "Attended", value: `${f.attendees} of ${f.registered} registered` },
              { label: "No-shows", value: String(f.noShows) },
              ...(f.unmatched
                ? [{ label: "Not matched to Luma", value: String(f.unmatched), note: "Counted as no-shows" }]
                : []),
              { label: "Each gets", value: ethText(f.share) },
            ]}
          />
          {model.downloads && (
            <div className="og-actions">
              <a className="kb-link" download="payout.csv" href={href(model.downloads.csv, "text/csv")}>
                <DownloadIcon /> payout.csv
              </a>
              <a className="kb-link" download="summary.md" href={href(model.downloads.summary, "text/markdown")}>
                <DownloadIcon /> summary.md
              </a>
            </div>
          )}
        </>
      )}
      {!posted && (
        <Primary gate={model.post} onPress={model.open} busy={model.busy}>
          Post the list
        </Primary>
      )}
      {frozen && (
        <ConfirmDialog
          isOpen
          title="Post the attendance list"
          intro="Read from the chain when you opened this. These are the figures you sign."
          figures={[
            { label: "Attended", value: `${frozen.attendees} of ${frozen.registered}` },
            { label: "No-shows", value: String(frozen.noShows) },
            { label: "Each gets", value: ethText(frozen.share) },
          ]}
          words={frozen.unmatched ? [TYPED_WORDS.noShow, TYPED_WORDS.post] : [TYPED_WORDS.post]}
          action="Post"
          busy={model.posting}
          error={model.error}
          onClose={model.close}
          onConfirm={(typed) =>
            void model.confirm(typed[typed.length - 1] ?? "", frozen.unmatched ? (typed[0] ?? "") : "")
          }
        />
      )}
    </div>
  );
}

export function AttendanceScreen() {
  const { overview, scope } = useOrganiserEvent();
  if (!overview.data) return <p className="og-note">Reading the event…</p>;
  return (
    <AttendanceLoaded
      cfg={overview.data.cfg}
      scope={scope}
      posted={overview.data.event.phase === 1 || overview.data.event.phase === 2}
    />
  );
}

function AttendanceLoaded({
  cfg,
  scope,
  posted,
}: {
  cfg: Parameters<typeof useAttendanceScreen>[0];
  scope: Parameters<typeof useAttendanceScreen>[1];
  posted: boolean;
}) {
  const model = useAttendanceScreen(cfg, scope);
  return <AttendanceView model={model} posted={posted || model.posted} />;
}
