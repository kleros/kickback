"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";
import { ArrowUpIcon } from "@/components/ui/icons";

import { spanText } from "@/utils/time";

import { HOW_IT_WORKS_ID } from "@/config/paths";

import { unitsText } from "../model/depositState";
import type { ShareExample } from "../model/share";
import type { EventClock } from "../model/when";
import { deadlineText, sameClock, visitorText } from "../model/when";

/** The deposit's asset, for every figure on the page. */
const Asset = createContext({ unit: "ETH", decimals: 18 });
const useAsset = () => {
  const { unit, decimals } = useContext(Asset);
  return { unit, text: (units: bigint) => unitsText(units, decimals) };
};

/** Sets data-inview once the element scrolls into view, so its figure plays once and then rests. */
function useInViewOnce<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);
  return { ref, seen };
}

function Panel({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  const { ref, seen } = useInViewOnce<HTMLElement>();
  return (
    <GlassCard ref={ref} as="article" className="how-panel" data-inview={seen ? "" : undefined} data-testid={testId}>
      <h3>{title}</h3>
      <div className="how-body">{children}</div>
    </GlassCard>
  );
}

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/** A gradient along the axis for the figure's flow lines; ids are per figure. */
function Axis({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" x2="408" y1="0" y2="0">
        <stop offset="0" stopColor="var(--kb-violet)" />
        <stop offset="1" stopColor="var(--kb-blue)" />
      </linearGradient>
    </defs>
  );
}

const useAxisId = () => `kb-axis-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

function Coin({
  x,
  y,
  r,
  label,
  stroke,
  delay,
}: {
  x: number;
  y: number;
  r: number;
  label: string;
  stroke: string;
  delay: number;
}) {
  return (
    <g className="pop" style={d(delay)}>
      <circle cx={x} cy={y} r={r} className="coin" stroke={stroke} />
      <text
        x={x}
        y={y + 4.5}
        textAnchor="middle"
        // a long amount ("0.0125", "1,000") shrinks to stay inside the coin
        style={
          label.length > 4
            ? { fontSize: `${Math.min(16, Math.floor((2 * r - 8) / (label.length * 0.6)))}px` }
            : undefined
        }
      >
        {label}
      </text>
    </g>
  );
}

/** A cancelled event, or a missed deadline to confirm who came: every guest gets exactly their deposit back. */
type RefundOnly = "cancelled" | "missed" | null;

function BackPanel({ amount, refundOnly }: { amount: string; refundOnly: RefundOnly }) {
  const { unit } = useAsset();
  const axis = useAxisId();
  const stroke = `url(#${axis})`;
  return (
    <Panel title="Do I get my deposit back?">
      <svg
        className="how-fig"
        viewBox="0 0 408 96"
        role="img"
        aria-label={
          refundOnly
            ? `A ${amount} ${unit} deposit comes back in full.`
            : `A ${amount} ${unit} deposit goes in and comes back with a share added.`
        }
      >
        <Axis id={axis} />
        <Coin x={52} y={48} r={28} label={amount} stroke={stroke} delay={0} />
        <path d="M92 48h70" className="flow" stroke={stroke} pathLength={1} style={d(150)} />
        <g className="pop" style={d(450)}>
          <rect x="176" y="20" width="56" height="56" rx="14" className="card" />
          <path d="M176 36h56M192 14v10M216 14v10" className="ink" />
          <path d="M193 56l7 7 13-15" className="ok" />
        </g>
        <path d="M246 48h70" className="flow" stroke={stroke} pathLength={1} style={d(700)} />
        <Coin x={356} y={48} r={28} label={amount} stroke={stroke} delay={1000} />
        {!refundOnly && (
          <g className="pop" style={d(1250)}>
            <circle cx="380" cy="24" r="11" fill={stroke} />
            <path d="M380 18.5v11M374.5 24h11" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        )}
      </svg>
      <div className="how-caps three">
        <span>
          <b>Deposit</b>
          {amount} {unit}
        </span>
        {refundOnly === "cancelled" ? (
          <span>
            <b>Cancelled</b>no check-in needed
          </span>
        ) : refundOnly === "missed" ? (
          <span>
            <b>Attendance</b>not confirmed in time
          </span>
        ) : (
          <span>
            <b>Attend</b>checked in
          </span>
        )}
        {refundOnly ? (
          <span>
            <b>Back in full</b>no share of other deposits
          </span>
        ) : (
          <span>
            <b>Back, plus a share</b>of <span className="nowrap">no-shows&apos;</span> deposits
          </span>
        )}
      </div>
    </Panel>
  );
}

function SplitPanel({
  example,
  refundOnly,
  amount: deposit,
}: {
  example: ShareExample;
  refundOnly: RefundOnly;
  amount: string;
}) {
  const { unit } = useAsset();
  if (refundOnly)
    return (
      <Panel title="What happens to no-shows' deposits?" testId="how-split">
        <p className="how-note" data-testid="how-refund-only">
          {refundOnly === "cancelled"
            ? `The organiser cancelled this event, so no deposits are shared: every guest gets back exactly ${deposit} ${unit}.`
            : `Attendance was not confirmed by the deadline, so no deposits are shared: every guest can withdraw exactly ${deposit} ${unit}.`}
        </p>
      </Panel>
    );
  return <SplitFigure example={example} />;
}

/** "a", "a and b", "a, b and c". */
const listText = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function SplitFigure({ example }: { example: ShareExample }) {
  const { unit, text } = useAsset();
  const axis = useAxisId();
  const stroke = `url(#${axis})`;
  const shown = Math.min(example.deposits, 10);
  // everyone on the list came: no no-show coin, no pool
  const none = example.noShows === 0;
  const shownNo = none
    ? 0
    : example.deposits <= 10
      ? example.noShows
      : Math.min(shown - 1, Math.max(1, Math.round((shown * example.noShows) / example.deposits)));
  // a guest with Kleros, or with a challenge still waiting for an answer: neither ticked nor pooled, each takes a share
  const shownHeld = example.deposits <= 10 ? example.held + example.pending : 0;
  const ways = example.attend + example.pending + example.held;
  // a case Kleros has ruled on still holds its share until someone settles it
  const ruled = example.ruled;
  const deciding = example.held - ruled;
  const caseWord = (n: number) => (n === 1 ? "case" : "cases");
  const heldParts = [
    deciding > 0 &&
      `One share is held for ${deciding === 1 ? (example.held === 1 ? "the open Kleros case" : "the case still with Kleros jurors") : `each of the ${deciding} cases still with Kleros jurors`} until ${deciding === 1 ? "it is" : "they are"} decided.`,
    ruled > 0 &&
      `Kleros has ruled on ${ruled === 1 ? "1 case" : `${ruled} cases`}; ${ruled === 1 ? "its share is" : "their shares are"} released once someone settles ${ruled === 1 ? "it" : "them"}.`,
  ].filter((x): x is string => !!x);
  const heldNote = heldParts.length ? ` ${heldParts.join(" ")}` : "";
  // before the release: what still takes a share besides the guests on the list
  const counted = [
    example.pending > 0 &&
      `${example.pending} ${example.pending === 1 ? "challenge" : "challenges"} still waiting for the organiser's answer`,
    deciding > 0 && `${deciding} ${caseWord(deciding)} with Kleros`,
    ruled > 0 && `${ruled} ruled ${caseWord(ruled)} waiting to be settled`,
  ].filter((x): x is string => !!x);
  const countedNote = `${example.pending > 0 ? " Each waiting challenge counts as a share: the guest either joins the list or goes to Kleros, where a share is held." : ""}${deciding > 0 ? ` A share is held for ${deciding === 1 ? "the case" : "each case"} with Kleros until ${deciding === 1 ? "it is" : "they are"} decided.` : ""}${ruled > 0 ? ` Kleros has ruled on ${ruled === 1 ? "1 case" : `${ruled} cases`}; ${ruled === 1 ? "its result counts" : "their results count"} once someone settles ${ruled === 1 ? "it" : "them"}.` : ""}`;
  // the circles neither ticked nor pooled: challenges waiting for an answer and cases with Kleros
  const inWait = example.pending + example.held;
  const waitLabel =
    example.held === 0
      ? "waiting for an answer"
      : example.pending === 0
        ? "with Kleros"
        : `${example.pending} waiting, ${example.held} with Kleros`;
  // the event is over once the list exists: what happened is told in the past tense
  const past = example.basis === "paid" || example.basis === "list";
  const paid = example.basis === "paid";
  const gap = 388 / shown;
  const xs = Array.from({ length: shown }, (_, i) => 10 + gap / 2 + i * gap);
  const attendX = xs.slice(0, shown - shownNo - shownHeld);
  const heldX = xs.slice(shown - shownNo - shownHeld, shown - shownNo);
  const noX = xs.slice(shown - shownNo);
  // a rounded amount carries "≈" once, where it is correct maths: on the sum, not on each figure
  const cut = (s: string) => s.replace(/^[~≈]/, "");
  const pool = cut(text(example.pool));
  const bonusRaw = text(example.bonus);
  const backRaw = text(example.back);
  const bonus = cut(bonusRaw);
  const approx = /^[~≈]/.test(bonusRaw) || /^[~≈]/.test(backRaw);
  const amount = text(example.back - example.bonus);
  const pillW = Math.max(76, (pool.length + unit.length + 1) * 8 + 20);
  const poolX = noX.length
    ? Math.min(Math.max(noX.reduce((a, b) => a + b, 0) / noX.length, pillW / 2 + 6), 402 - pillW / 2)
    : 204;
  const pillL = poolX - pillW / 2;
  const pillR = poolX + pillW / 2;
  // an attendee above the pill takes their share from its top edge (on the rounded corner where it falls);
  // the others hang from the line that leaves the pill's left side
  const pillTop = (x: number) => {
    const dx = Math.min(x - pillL, pillR - x);
    return dx >= 12 ? 62 : 74 - Math.sqrt(144 - (12 - dx) ** 2);
  };
  const busStart = Math.max(pillL - 4, ...attendX.filter((x) => x < pillL));
  const noShowsPossessive = example.noShows === 1 ? "no-show's" : "no-shows'";
  const depositsText = `${example.deposits} ${example.deposits === 1 ? "deposit" : "deposits"}`;
  const note: ReactNode =
    example.basis === "paid" ? (
      `This event's result: ${depositsText} and ${example.attend} ${example.attend === 1 ? "attendee" : "attendees"}.${heldNote}`
    ) : example.basis === "list" ? (
      counted.length ? (
        `Based on this event's ${depositsText}, the ${example.attend} ${example.attend === 1 ? "guest" : "guests"} on the list so far${counted.length > 1 ? ", " : " and "}${listText(counted)}.${countedNote}`
      ) : (
        `Based on this event's ${depositsText} and the ${example.attend} ${example.attend === 1 ? "guest" : "guests"} on the list so far.`
      )
    ) : example.basis === "estimate" ? (
      <>
        An example with this event&apos;s {depositsText} and{" "}
        <span className="nowrap">
          {example.noShows} {example.noShows === 1 ? "no-show" : "no-shows"}.
        </span>
      </>
    ) : none ? (
      <>An example with {depositsText}, where everyone attends.</>
    ) : (
      <>
        An example with {depositsText} and{" "}
        <span className="nowrap">
          {example.noShows} {example.noShows === 1 ? "no-show" : "no-shows"}.
        </span>
      </>
    );
  const split = paid
    ? ways === 1
      ? "went to the one attendee"
      : `was split ${ways} ways`
    : ways === 1
      ? "goes to the one attendee"
      : `is split ${ways} ways`;
  const countedAria = counted.length ? ` Still counted: ${listText(counted)}.` : "";
  const ariaLabel = none
    ? inWait > 0
      ? `${depositsText}: ${example.attend} on the list.${paid ? heldNote : countedAria}`
      : `${depositsText}: everyone ${past ? "attended" : "attends"}, so each attendee gets their deposit back.`
    : past
      ? `${depositsText}: ${example.attend} ${example.attend === 1 ? "guest attended" : "guests attended"} and ${example.noShows} did not. The ${noShowsPossessive} ${pool} ${unit} ${split}.${paid ? heldNote : countedAria}`
      : `${depositsText}: ${example.attend} ${example.attend === 1 ? "guest attends" : "guests attend"} and ${example.noShows} ${example.noShows === 1 ? "does" : "do"} not. The ${noShowsPossessive} ${pool} ${unit} ${split}.`;

  return (
    <Panel title="What happens to no-shows' deposits?" testId="how-split">
      <svg className="how-fig" viewBox={none ? "0 0 408 40" : "0 0 408 112"} role="img" aria-label={ariaLabel}>
        <Axis id={axis} />
        {attendX.map((x, i) => (
          <g key={`a${i}`} className="pop" style={d(i * 50)}>
            <circle cx={x} cy={20} r={Math.min(13, gap / 2 - 3)} className="coin" stroke={stroke} />
            <path d={`M${x - 5} 20.5l3.5 3.5 7-8`} className="ok" />
          </g>
        ))}
        {heldX.map((x, i) => (
          <g key={`h${i}`} className="pop" style={d((attendX.length + i) * 50)}>
            <circle cx={x} cy={20} r={Math.min(13, gap / 2 - 3)} className="coin held" stroke={stroke} />
            <text x={x} y={24.5} textAnchor="middle" className="q">
              ?
            </text>
          </g>
        ))}
        {noX.map((x, i) => (
          <g key={`n${i}`}>
            <circle cx={x} cy={20} r={Math.min(13, gap / 2 - 3)} className="muted" />
            <path d={`M${x} 36V62H${poolX}`} className="flow" stroke={stroke} pathLength={1} style={d(500)} />
          </g>
        ))}
        {!none && (
          <>
            <g className="pop" style={d(900)}>
              <rect x={pillL} y={62} width={pillW} height={30} rx={12} className="card" />
              <text x={poolX} y={81.5} textAnchor="middle">
                {pool} {unit}
              </text>
            </g>
            <path
              d={`M${busStart} 77H${attendX[0] ?? 20}V38`}
              className="flow"
              stroke={stroke}
              pathLength={1}
              style={d(1100)}
            />
            {attendX.slice(1).map((x, i) => (
              <path
                key={i}
                d={`M${x} ${x >= pillL && x <= pillR ? pillTop(x).toFixed(1) : 77}V38`}
                className="flow"
                stroke={stroke}
                pathLength={1}
                style={d(1300 + i * 40)}
              />
            ))}
            <text x={pillL - 10} y={106} textAnchor="end" className="dim">
              ÷ {ways}
            </text>
          </>
        )}
      </svg>
      <div className={`how-caps ${inWait > 0 ? "three" : "two"}`}>
        <span>
          <b>
            {example.attend} {example.attend === 1 ? "attendee" : "attendees"}
          </b>
          +{bonus} {unit}
          {example.attend === 1 ? "" : " each"}
        </span>
        {inWait > 0 && (
          <span data-testid="how-held">
            <b>
              {inWait} {inWait === 1 ? "challenge" : "challenges"}
            </b>
            {waitLabel}
          </span>
        )}
        <span>
          <b>
            {example.noShows} {example.noShows === 1 ? "no-show" : "no-shows"}
          </b>
          pooled
        </span>
      </div>
      <div className="how-sum" data-testid="how-sum" data-back={example.back.toString()} data-attend={example.attend}>
        <span>Each attendee gets back</span>
        <b>
          {amount} + {bonus} {approx ? "≈" : "="} {cut(backRaw)} {unit}
        </b>
      </div>
      <p className="how-note">{note}</p>
    </Panel>
  );
}

function ListPanel({
  refundOnly,
  ruledCases,
  court,
  challengeFee,
  matchPeriod,
  phase,
  now,
  challengeEndsAt,
  openCases,
  challengeCount,
  casesSent,
  clock,
}: {
  /** Cancelled, or attendance never confirmed in time: there is no list to challenge. */
  refundOnly: RefundOnly;
  /** Open cases Kleros has ruled on that nobody has settled yet; undefined when unknown. */
  ruledCases?: number;
  court: string;
  challengeFee?: bigint;
  matchPeriod: number;
  /** The contract's phase: 0 open, 1 list posted, 2 paid out, 3 cancelled. */
  phase: number;
  /** The chain's time; undefined while loading (the instructions stay). */
  now?: number;
  /** 0 until the list is closed. */
  challengeEndsAt: number;
  /** Kleros cases still open, before or after the payout. */
  openCases: number;
  /** Challenges ever made; undefined when unknown. */
  challengeCount?: number;
  /** Challenges sent to Kleros; undefined when unknown. */
  casesSent?: number;
  clock: EventClock | null;
}) {
  const axis = useAxisId();
  const stroke = `url(#${axis})`;
  const noList = refundOnly !== null;
  // the challenge window is over: what happened is told in the past tense
  const over = !noList && challengeEndsAt > 0 && now !== undefined && now > challengeEndsAt;
  const ruled = Math.max(0, Math.min(ruledCases ?? 0, openCases));
  const deciding = openCases - ruled;
  // what the jurors did, told only from what happened: no challenge, no case, a case still open, or all decided
  const jurors: readonly [string, string] = noList
    ? ["No court cases", "nothing went to Kleros"]
    : !over
      ? ["Jurors decide", "on the evidence"]
      : challengeCount === 0
        ? ["No challenges", "no one challenged the list"]
        : casesSent === 0
          ? ["No court cases", "no challenge went to Kleros"]
          : deciding > 0
            ? ["Jurors decide", "each case sent to them"]
            : ruled > 0
              ? ["Jurors ruled", "on each case sent to them"]
              : ["Jurors", "decided each case sent to them"];
  const casesText = (n: number) => (n === 1 ? "One case is" : `${n} cases are`);
  const openText = [
    deciding > 0 &&
      ` ${casesText(deciding)} still with Kleros jurors${phase === 2 ? `; a share is held until ${deciding === 1 ? "it is" : "they are"} decided` : ""}.`,
    ruled > 0 &&
      ` Kleros has ruled on ${ruled === 1 ? "1 case" : `${ruled} cases`}; ${phase === 2 ? `${ruled === 1 ? "its share is" : "their shares are"} released` : `${ruled === 1 ? "the result counts" : "the results count"}`} once someone settles ${ruled === 1 ? "it" : "them"}.`,
  ]
    .filter((x): x is string => !!x)
    .join("");
  return (
    <Panel title="Left off the list?">
      <svg
        className="how-fig"
        viewBox="0 0 408 104"
        role="img"
        aria-label="An attendance list with one name unchecked, and the court beside it."
      >
        <Axis id={axis} />
        <rect x="30" y="8" width="170" height="88" rx="16" className="card" />
        <path d="M50 28h64M50 48h50M50 68h70M50 86h40" className="ink" strokeWidth="4" opacity="0.35" />
        <path d="M168 24l4 4 7-8M168 44l4 4 7-8M168 82l4 4 7-8" className="ok" />
        <circle cx="174" cy="66" r="6" className="muted" />
        <path d="M214 66h70" className="flow" stroke={stroke} pathLength={1} style={d(300)} />
        <g className="pop" style={d(700)}>
          <circle cx="336" cy="52" r="36" className="coin" stroke={stroke} />
          <path d="M336 32v38M326 70h20M320 40h32M320 40l-6 13h12l-6-13zM352 40l-6 13h12l-6-13z" className="ink" />
        </g>
      </svg>
      <div className="how-caps three">
        <span>
          <b>Not on the list</b>but you were there
        </span>
        <span>
          <b>{noList ? "No challenges" : over ? "Challenges" : "Challenge it"}</b>in {court}
        </span>
        <span>
          <b>{jurors[0]}</b>
          {jurors[1]}
        </span>
      </div>
      {noList ? (
        <p className="how-note" data-testid="challenge-fee">
          {refundOnly === "cancelled"
            ? "The organiser cancelled this event, so there is no list to challenge."
            : "Attendance was not confirmed in time, so there is no list to challenge."}
        </p>
      ) : over ? (
        <p className="how-note" data-testid="challenge-fee">
          Challenges closed on {deadlineText(challengeEndsAt, clock)}.
          {challengeCount === 0 ? " No one challenged the list." : ""}
          {openText}
        </p>
      ) : (
        <p className="how-note" data-testid="challenge-fee">
          To challenge, you pay the Kleros fee
          {challengeFee ? ` (currently ${unitsText(challengeFee, 18)} ETH, set by Kleros)` : ""}. If the organiser does
          not answer within {spanText(matchPeriod)}, you can join the list and get the fee back. If they send the case
          to Kleros, they pay the same fee and Kleros jurors decide: whichever side wins gets back what is left of the
          two fees.
          {challengeEndsAt > 0 ? ` Challenges are open until ${deadlineText(challengeEndsAt, clock)}.` : ""}
        </p>
      )}
    </Panel>
  );
}

function TimelinePanel({
  eventEnd,
  claimDeadline,
  challengePeriod,
  challengeEndsAt,
  clock,
  now,
  phase,
}: {
  eventEnd: number;
  claimDeadline: number;
  /** The contract's phase: 0 open, 1 list posted, 2 paid out, 3 cancelled. */
  phase: number;
  challengePeriod: number;
  challengeEndsAt: number;
  clock: EventClock | null;
  /** The chain's time; undefined while loading. */
  now?: number;
}) {
  const axis = useAxisId();
  const stroke = `url(#${axis})`;
  const cancelled = phase === 3;
  const missed = phase === 0 && now !== undefined && now > claimDeadline;
  // paid out: the strip tells what happened
  const done = phase === 2;
  const ended = done || cancelled || (now !== undefined && now >= eventEnd);
  const windowOver = challengeEndsAt > 0 && now !== undefined && now > challengeEndsAt;
  // once the list is posted, the rows follow what happened: posted, then the challenge window
  const rows: readonly (readonly [string, number])[] = cancelled
    ? []
    : challengeEndsAt
      ? [
          ["Deposits closed", eventEnd],
          ["Attendance confirmed", challengeEndsAt - challengePeriod],
          [now !== undefined && now > challengeEndsAt ? "Challenges closed" : "Challenges close", challengeEndsAt],
        ]
      : [
          [now !== undefined && now >= eventEnd ? "Deposits closed" : "Deposits close", eventEnd],
          [missed ? "Attendance not confirmed by" : "Attendance confirmed by", claimDeadline],
        ];
  return (
    <Panel title="When does it all happen?" testId="how-deadlines">
      <svg
        className="how-fig"
        viewBox="0 0 408 48"
        role="img"
        aria-label={
          cancelled
            ? "The organiser cancelled this event; every guest gets their full deposit back."
            : missed
              ? "Deposits closed when the event ended; who came was not confirmed in time, so every guest can withdraw their full deposit."
              : `Deposits close when the event ends; who came is confirmed by the deadline; ${spanText(challengePeriod)} for challenges; then payouts.`
        }
      >
        <Axis id={axis} />
        <path d="M51 34h306" className="ln" />
        <path d="M51 34h306" className="flow" stroke={stroke} pathLength={1} style={d(100)} />
        <circle cx="51" cy="34" r="6" fill="var(--kb-violet)" className="pop" style={d(0)} />
        <circle cx="153" cy="34" r="6" className="card pop" style={d(450)} />
        <circle cx="255" cy="34" r="6" className="card pop" style={d(700)} />
        <circle cx="357" cy="34" r="6" fill="var(--kb-ok)" className="pop" style={d(950)} />
        {!cancelled && !missed && (
          <>
            <path d="M153 14h102M153 10v8M255 10v8" className="ink" />
            <text x="204" y="9" textAnchor="middle" className="dim">
              {spanText(challengePeriod)}
            </text>
          </>
        )}
      </svg>
      <div className="how-caps four">
        {cancelled ? (
          <>
            <span>
              <b>Cancelled</b>by the organiser
            </span>
            <span>
              <b>Attendance</b>no list
            </span>
            <span>
              <b>Challenges</b>none
            </span>
            <span>
              <b>Refunds</b>withdrawn by guests or sent by the organiser
            </span>
          </>
        ) : (
          <>
            <span>
              <b>{ended ? "Ended" : "Ends"}</b>
              {ended ? "deposits closed" : "deposits close"}
            </span>
            {missed ? (
              <>
                <span>
                  <b>Attendance</b>not confirmed in time
                </span>
                <span>
                  <b>Challenges</b>none
                </span>
                <span>
                  <b>Refunds</b>withdrawn by guests or sent by the organiser
                </span>
              </>
            ) : (
              <>
                <span>
                  <b>Attendance</b>confirmed by the organiser
                </span>
                <span>
                  <b>Challenges</b>
                  {done || windowOver ? "closed" : spanText(challengePeriod)}
                </span>
                <span>
                  <b>Payouts</b>
                  {done ? "released" : "claimed by attendees or sent by the organiser"}
                </span>
              </>
            )}
          </>
        )}
      </div>
      {rows.length > 0 && (
        <div className="how-caps" style={{ marginTop: 16 }}>
          {rows.map(([label, unix]) => (
            <div key={label} className="how-sum is-stack" style={{ marginTop: 0 }}>
              <span>{label}</span>
              <span className="how-sum-date">
                <b className="kb-num">{deadlineText(unix, clock)}</b>
                {!sameClock(unix, clock) && <span className="how-when">{visitorText(unix)} your time</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {!challengeEndsAt && (
        <p className="how-note">
          {cancelled
            ? "The organiser cancelled this event. Every guest gets their full deposit back."
            : missed
              ? "Attendance was not confirmed in time. You can withdraw your full deposit."
              : "Attendance not confirmed by the deadline? You can withdraw your full deposit."}
        </p>
      )}
    </Panel>
  );
}

export interface HowItWorksProps {
  amount: string;
  /** The deposit's asset: "ETH", "USDC", and its decimals. */
  unit: string;
  decimals: number;
  example: ShareExample;
  eventEnd: number;
  claimDeadline: number;
  challengePeriod: number;
  /** 0 until the list is closed. */
  challengeEndsAt: number;
  clock: EventClock | null;
  court: string;
  /** Kleros's fee a guest pays to challenge, in wei, read now. */
  challengeFee?: bigint;
  /** Seconds the organiser has to answer a challenge. */
  matchPeriod: number;
  /** The chain's time, unix seconds; undefined while loading. */
  now?: number;
  /** The contract's phase: 0 open, 1 list posted, 2 paid out, 3 cancelled. */
  phase: number;
  /** Kleros cases not settled yet. */
  openCases: number;
  /** Of those, the cases Kleros has ruled on; undefined when unknown. */
  ruledCases?: number;
  /** Challenges ever made; undefined when unknown. */
  challengeCount?: number;
  /** Challenges sent to Kleros; undefined when unknown. */
  casesSent?: number;
  /** The closing button: back up to the card. */
  onDeposit: () => void;
  depositOpen: boolean;
}

/** Below the card, in its own band: the guest's questions, answered with figures that play once. */
export function HowItWorks({
  amount,
  unit,
  decimals,
  example,
  eventEnd,
  claimDeadline,
  challengePeriod,
  challengeEndsAt,
  clock,
  court,
  challengeFee,
  matchPeriod,
  now,
  phase,
  openCases,
  ruledCases,
  challengeCount,
  casesSent,
  onDeposit,
  depositOpen,
}: HowItWorksProps) {
  const refundOnly: RefundOnly =
    phase === 3 ? "cancelled" : phase === 0 && now !== undefined && now > claimDeadline ? "missed" : null;
  return (
    <Asset.Provider value={{ unit, decimals }}>
      <section id={HOW_IT_WORKS_ID} className="kb-how" aria-labelledby="how-title">
        <h2 id="how-title" className="how-title">
          How it works
        </h2>
        <div className="how-grid">
          <BackPanel amount={amount} refundOnly={refundOnly} />
          <SplitPanel example={example} refundOnly={refundOnly} amount={amount} />
          <ListPanel
            refundOnly={refundOnly}
            ruledCases={ruledCases}
            court={court}
            challengeFee={challengeFee}
            matchPeriod={matchPeriod}
            phase={phase}
            now={now}
            challengeEndsAt={challengeEndsAt}
            openCases={openCases}
            challengeCount={challengeCount}
            casesSent={casesSent}
            clock={clock}
          />
          <TimelinePanel
            eventEnd={eventEnd}
            claimDeadline={claimDeadline}
            challengePeriod={challengePeriod}
            challengeEndsAt={challengeEndsAt}
            clock={clock}
            now={now}
            phase={phase}
          />
        </div>
        {depositOpen && (
          <div className="how-cta">
            <GradientButton wide onPress={onDeposit} icon={<ArrowUpIcon />}>
              {`Deposit ${amount} ${unit}`}
            </GradientButton>
          </div>
        )}
      </section>
    </Asset.Provider>
  );
}
