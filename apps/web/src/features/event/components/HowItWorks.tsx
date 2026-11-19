"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { EventClock } from "../model/when";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";
import { ArrowUpIcon } from "@/components/ui/icons";

import { HOW_IT_WORKS_ID } from "@/config/paths";

import { unitsText } from "../model/depositState";
import type { ShareExample } from "../model/share";
import { deadlineText, sameClock, visitorText } from "../model/when";

const DAY = 86_400;

/** The deposit's asset, for every figure on the page. */
const Asset = createContext({ unit: "ETH", decimals: 18 });
const useAsset = () => {
  const { unit, decimals } = useContext(Asset);
  return { unit, text: (units: bigint) => unitsText(units, decimals) };
};

/** "1 day", "12 hours". */
const spanText = (seconds: number) =>
  seconds % DAY === 0
    ? `${seconds / DAY} ${seconds === DAY ? "day" : "days"}`
    : `${Math.round(seconds / 3600)} ${seconds === 3600 ? "hour" : "hours"}`;

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
      {children}
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
      <text x={x} y={y + 4.5} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function BackPanel({ amount }: { amount: string }) {
  const { unit } = useAsset();
  const axis = useAxisId();
  const stroke = `url(#${axis})`;
  return (
    <Panel title="Do I get my deposit back?">
      <svg
        className="how-fig"
        viewBox="0 0 408 96"
        role="img"
        aria-label={`A ${amount} ${unit} deposit goes in and comes back with a share added.`}
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
        <g className="pop" style={d(1250)}>
          <circle cx="380" cy="24" r="11" fill={stroke} />
          <path d="M380 18.5v11M374.5 24h11" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      </svg>
      <div className="how-caps three">
        <span>
          <b>Deposit</b>
          {amount}{" "}{unit}
        </span>
        <span>
          <b>Attend</b>checked in
        </span>
        <span>
          <b>Back, plus a share</b>of the no-shows
        </span>
      </div>
    </Panel>
  );
}

function SplitPanel({ example }: { example: ShareExample }) {
  const { unit, text } = useAsset();
  const axis = useAxisId();
  const stroke = `url(#${axis})`;
  const shown = Math.min(example.deposits, 10);
  const shownNo =
    example.deposits <= 10 ? example.noShows : Math.max(1, Math.round((shown * example.noShows) / example.deposits));
  const gap = 388 / shown;
  const xs = Array.from({ length: shown }, (_, i) => 10 + gap / 2 + i * gap);
  const attendX = xs.slice(0, shown - shownNo);
  const noX = xs.slice(shown - shownNo);
  const poolX = Math.min(Math.max(noX.reduce((a, b) => a + b, 0) / noX.length, 50), 358);
  const pool = text(example.pool);
  const bonus = text(example.bonus);
  const amount = text(example.back - example.bonus);

  return (
    <Panel title="What happens to no-shows' deposits?" testId="how-split">
      <svg
        className="how-fig"
        viewBox="0 0 408 112"
        role="img"
        aria-label={`${example.deposits} deposits; ${example.attend} attend and ${example.noShows} do not. The no-shows' ${pool} ${unit} is split ${example.attend} ways.`}
      >
        <Axis id={axis} />
        {attendX.map((x, i) => (
          <g key={`a${i}`} className="pop" style={d(i * 50)}>
            <circle cx={x} cy={20} r={Math.min(13, gap / 2 - 3)} className="coin" stroke={stroke} />
            <path d={`M${x - 5} 20.5l3.5 3.5 7-8`} className="ok" />
          </g>
        ))}
        {noX.map((x, i) => (
          <g key={`n${i}`}>
            <circle cx={x} cy={20} r={Math.min(13, gap / 2 - 3)} className="muted" />
            <path d={`M${x} 36V62H${poolX}`} className="flow" stroke={stroke} pathLength={1} style={d(500)} />
          </g>
        ))}
        <g className="pop" style={d(900)}>
          <rect x={poolX - 44} y={62} width={88} height={30} rx={12} className="card" />
          <text x={poolX} y={81.5} textAnchor="middle">
            {pool}{" "}{unit}
          </text>
        </g>
        <path
          d={`M${poolX - 48} 77H${attendX[0] ?? 20}V38`}
          className="flow"
          stroke={stroke}
          pathLength={1}
          style={d(1100)}
        />
        {attendX.slice(1).map((x, i) => (
          <path key={i} d={`M${x} 77V38`} className="flow" stroke={stroke} pathLength={1} style={d(1300 + i * 40)} />
        ))}
        <text x={poolX - 54} y={106} textAnchor="end" className="dim">
          ÷ {example.attend}
        </text>
      </svg>
      <div className="how-caps two">
        <span>
          <b>{example.attend} attend</b>+{bonus}{" "}{unit} each
        </span>
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
          {amount} + {bonus} = {text(example.back)} {unit}
        </b>
      </div>
      <p className="how-note">
        {example.real ? `With ${example.deposits} guests registered.` : "An example with ten deposits."}
      </p>
    </Panel>
  );
}

function ListPanel({ court }: { court: string }) {
  const axis = useAxisId();
  const stroke = `url(#${axis})`;
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
          <b>Challenge it</b>in {court}
        </span>
        <span>
          <b>Jurors decide</b>on the evidence
        </span>
      </div>
      <p className="how-note">Each side pays the Kleros fee up front. The side the jurors agree with gets it back.</p>
    </Panel>
  );
}

function TimelinePanel({
  eventEnd,
  claimDeadline,
  challengePeriod,
  challengeEndsAt,
  clock,
}: {
  eventEnd: number;
  claimDeadline: number;
  challengePeriod: number;
  challengeEndsAt: number;
  clock: EventClock | null;
}) {
  const axis = useAxisId();
  const stroke = `url(#${axis})`;
  const rows = [
    ["Deposits close", eventEnd],
    ["List due by", claimDeadline],
    ...(challengeEndsAt ? ([["Challenges close", challengeEndsAt]] as const) : []),
  ] as const;
  return (
    <Panel title="When does it all happen?" testId="how-deadlines">
      <svg
        className="how-fig"
        viewBox="0 0 408 48"
        role="img"
        aria-label={`Deposits close when the event ends; the list is posted by the deadline; ${spanText(challengePeriod)} for challenges; then payouts.`}
      >
        <Axis id={axis} />
        <path d="M16 34h376" className="ln" />
        <path d="M16 34h376" className="flow" stroke={stroke} pathLength={1} style={d(100)} />
        <circle cx="16" cy="34" r="6" fill="var(--kb-violet)" className="pop" style={d(0)} />
        <circle cx="176" cy="34" r="6" className="card pop" style={d(450)} />
        <circle cx="296" cy="34" r="6" className="card pop" style={d(700)} />
        <circle cx="392" cy="34" r="6" fill="var(--kb-ok)" className="pop" style={d(950)} />
        <path d="M176 14h120M176 10v8M296 10v8" className="ink" />
        <text x="236" y="9" textAnchor="middle" className="dim">
          {spanText(challengePeriod)}
        </text>
      </svg>
      <div className="how-caps four">
        <span>
          <b>Ends</b>deposits close
        </span>
        <span>
          <b>List</b>by the deadline
        </span>
        <span>
          <b>Challenges</b>{spanText(challengePeriod)}
        </span>
        <span>
          <b>Paid out</b>to attendees
        </span>
      </div>
      <div className="how-caps" style={{ marginTop: 16 }}>
        {rows.map(([label, unix]) => (
          <div key={label} className="how-sum" style={{ marginTop: 0 }}>
            <span>{label}</span>
            <span style={{ textAlign: "right" }}>
              <b className="kb-num">{deadlineText(unix, clock)}</b>
              {!sameClock(unix, clock) && <span className="how-when">{visitorText(unix)} your time</span>}
            </span>
          </div>
        ))}
      </div>
      <p className="how-note">No list by the deadline? Withdraw your deposit in full.</p>
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
  onDeposit,
  depositOpen,
}: HowItWorksProps) {
  return (
    <Asset.Provider value={{ unit, decimals }}>
    <section id={HOW_IT_WORKS_ID} className="kb-how" aria-labelledby="how-title">
      <h2 id="how-title" className="how-title">
        How it works
      </h2>
      <div className="how-grid">
        <BackPanel amount={amount} />
        <SplitPanel example={example} />
        <ListPanel court={court} />
        <TimelinePanel
          eventEnd={eventEnd}
          claimDeadline={claimDeadline}
          challengePeriod={challengePeriod}
          challengeEndsAt={challengeEndsAt}
          clock={clock}
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
