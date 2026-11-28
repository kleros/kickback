import { csvCell } from "@kickback/core";
import { zeroAddress, type Address, type Hash } from "viem";

/**
 * What a payment out of the event was for. `payout`: a share of the pool after the release. `refund`: a deposit
 * given back (turned away, cancelled, deadline missed). `challenge`: challenge money coming back (the extra sent
 * with a challenge or a match, a fee returned, what is left of the two fees after a Kleros ruling).
 */
export type PaymentKind = "payout" | "refund" | "challenge";

/** How a payment left the event: `claimed` (withdraw by the account), `sent` (someone's distribute), `auto`. */
export type PaymentVia = "claimed" | "sent" | "auto";

/** One money movement out of the event, as the contract's Paid log records it. */
export interface Payment {
  tx: Hash;
  block: bigint;
  amount: bigint;
  to: Address;
  eth: boolean;
  kind: PaymentKind;
  /** Known once the transaction itself is read: withdraw is a claim, distribute a send, anything else a push. */
  via?: PaymentVia;
  /** The wallet that sent the transaction, when it is known. */
  sender?: Address;
  /** The event's organiser when it was paid (the event can be handed over later). */
  organiserThen?: Address;
}

/** A push the receiving wallet refused (PaymentFailed): the amount stays claimable. */
export interface FailedPayment {
  tx: Hash;
  block: bigint;
  amount: bigint;
  eth: boolean;
  kind: PaymentKind;
}

/** How a challenge was answered: added by the organiser, sent to Kleros, or accepted with no answer in time. */
export interface ChallengeAnswer {
  kind: "added" | "kleros" | "unanswered" | "accepted";
  tx: Hash;
  block: bigint;
  /** Kleros only: who paid the matching fee, and the Kleros case number. */
  matcher?: Address;
  caseId?: bigint;
  /** The event's organiser when it was answered. */
  organiserThen?: Address;
}

export interface ChallengeRecord {
  tx: Hash;
  block: bigint;
  /** The Kleros fee the guest paid to challenge. */
  fee: bigint;
  answer?: ChallengeAnswer;
  /** The settlement of a Kleros case: its ruling (0 refused, 1 came, 2 did not come). */
  resolved?: { tx: Hash; block: bigint; attended: boolean; ruling: number };
  /**
   * A lost case after the payout: its held share was split among the attendees and the cases still open then
   * (`attendees + openCases` ways, `each` to every one of them).
   */
  heldSplit?: { tx: Hash; block: bigint; each: bigint; attendees: bigint; openCases: bigint };
}

export interface WalletRecord {
  deposit?: { tx: Hash; block: bigint; amount: bigint };
  /** Turned away by the organiser (the refund itself is a Payment in the same transaction). */
  rejected?: { tx: Hash; block: bigint };
  payments: Payment[];
  failed: FailedPayment[];
  challenge?: ChallengeRecord;
  /** Kleros fees this wallet paid to send someone's challenge to Kleros (matchChallenge). */
  klerosFees: {
    tx: Hash;
    block: bigint;
    staker: Address;
    amount: bigint;
    caseId: bigint;
    /** The event's organiser when the fee was paid. */
    organiserThen?: Address;
  }[];
  /** Put on the list (AttendeeAdded), and how: see `AttendanceHow`. */
  added?: { tx: Hash; block: bigint; how: AttendanceHow };
}

/**
 * How a guest got on the list: `saved` (posted before the list was closed), `closed` (in the closing
 * transaction), `late` (added by the organiser after closing, in the challenge window) or `challenge` (the answer
 * to their challenge, or a Kleros ruling: already told as the challenge's answer or settlement).
 */
export type AttendanceHow = "saved" | "closed" | "late" | "challenge";

/** One transaction that put guests on the list (not a challenge's answer). */
export interface AttendanceTx {
  tx: Hash;
  block: bigint;
  how: Exclude<AttendanceHow, "challenge">;
  wallets: Address[];
  /** The organiser who sent it (only the organiser can), when known. */
  by?: Address;
}

/** The event handed to another organiser wallet (acceptOwnership). */
export interface Handover {
  tx: Hash;
  block: bigint;
  from: Address;
  to: Address;
}

/** Every transaction that moved or settled the event's money, read from its own logs. */
export interface EventRecord {
  wallets: Map<string, WalletRecord>;
  created?: { tx: Hash; block: bigint };
  /** The organiser the event was created for. */
  firstOrganiser?: Address;
  /** Each time the event was handed to another organiser wallet, in chain order. */
  handovers: Handover[];
  /** `by`: the organiser who closed it. */
  listClosed?: { tx: Hash; block: bigint; by?: Address };
  /** `by`: the wallet that released (anyone can), when its transaction could be read; `organiserThen`: the organiser then. */
  released?: { tx: Hash; block: bigint; share: bigint; by?: Address; organiserThen?: Address };
  /** `by`: the organiser who cancelled it. */
  cancelled?: { tx: Hash; block: bigint; by?: Address };
  /** Each transaction that put guests on the list, in chain order (saved, closed or added after closing). */
  attendanceTxs: AttendanceTx[];
}

export type RecordLog = {
  eventName: string;
  args: {
    staker?: Address;
    attendee?: Address;
    account?: Address;
    to?: Address;
    amount?: bigint;
    eth?: boolean;
    share?: bigint;
    deposit?: bigint;
    matcher?: Address;
    arbitratorDisputeID?: bigint;
    attended?: boolean;
    ruling?: bigint;
    each?: bigint;
    attendees?: bigint;
    openCases?: bigint;
    previousOwner?: Address;
    newOwner?: Address;
  };
  transactionHash: Hash | null;
  blockNumber: bigint | null;
};

/** The transaction behind some logs: who sent it and which function it called (by name). */
export type TxInfo = { from: Address; fn?: string };

const CHALLENGE_STEPS = new Set(["Challenged", "ChallengeMatched", "ChallengeResolved"]);

/**
 * Folds the event's logs, in chain order, into one record per lower-case wallet plus the event-wide steps.
 * `txs` (optional) names each transaction's sender and function, so claims, sends and answers are told apart.
 */
export function foldRecord(logs: readonly RecordLog[], txs?: ReadonlyMap<string, TxInfo>): EventRecord {
  const record: EventRecord = { wallets: new Map(), attendanceTxs: [], handovers: [] };
  // the organiser at each point of the logs, in chain order: the sender of every organiser-only step, and the
  // organiser to credit for anything else (a handover in the same block counts only when its log comes first)
  let owner: Address | undefined;
  const walletOf = (address: Address) => {
    const key = address.toLowerCase();
    let row = record.wallets.get(key);
    if (!row) record.wallets.set(key, (row = { payments: [], failed: [], klerosFees: [] }));
    return row;
  };
  const live = logs.filter((l) => l.blockNumber !== null && !!l.transactionHash);
  // which steps each transaction holds, and the last money log of each account in it
  const names = new Map<string, Set<string>>();
  const last = new Map<string, number>();
  // the guests whose challenge a transaction settled: their AttendeeAdded is that challenge's answer
  const resolvedIn = new Set<string>();
  live.forEach((log, i) => {
    const tx = log.transactionHash!.toLowerCase();
    if (!names.has(tx)) names.set(tx, new Set());
    names.get(tx)!.add(log.eventName);
    if (log.eventName === "ChallengeResolved" && log.args.staker)
      resolvedIn.add(`${tx}:${log.args.staker.toLowerCase()}`);
    if ((log.eventName === "Paid" || log.eventName === "PaymentFailed") && log.args.account)
      last.set(`${tx}:${log.args.account.toLowerCase()}`, i);
  });
  const isChallengeTx = (tx: string) => [...(names.get(tx) ?? [])].some((n) => CHALLENGE_STEPS.has(n));
  // challenge ETH whose push was refused: it comes out later, last, in that wallet's withdraw or distribute
  const challengeOwed = new Map<string, bigint>();

  live.forEach((log, i) => {
    const hash = log.transactionHash!;
    const tx = hash.toLowerCase();
    const at = { tx: hash, block: log.blockNumber! };
    const { args } = log;
    const info = txs?.get(tx);
    const moneyKind = (account: Address): PaymentKind => {
      const key = account.toLowerCase();
      if (isChallengeTx(tx)) return "challenge";
      if ((challengeOwed.get(key) ?? 0n) > 0n && last.get(`${tx}:${key}`) === i) return "challenge";
      if (names.get(tx)?.has("Rejected") || walletOf(account).rejected) return "refund";
      return record.released ? "payout" : "refund";
    };
    switch (log.eventName) {
      case "OwnershipTransferred":
        if (!args.newOwner) break;
        if (!args.previousOwner || args.previousOwner.toLowerCase() === zeroAddress)
          record.firstOrganiser = args.newOwner;
        else record.handovers.push({ ...at, from: args.previousOwner, to: args.newOwner });
        owner = args.newOwner;
        break;
      case "EventCreated":
        record.created = at;
        break;
      case "Deposited":
        if (args.staker) walletOf(args.staker).deposit = { ...at, amount: args.amount ?? 0n };
        break;
      case "Rejected":
        if (args.staker) walletOf(args.staker).rejected = at;
        break;
      case "Paid": {
        if (!args.account) break;
        const key = args.account.toLowerCase();
        const kind = moneyKind(args.account);
        if (kind === "challenge" && !isChallengeTx(tx)) challengeOwed.set(key, 0n);
        walletOf(args.account).payments.push({
          ...at,
          amount: args.amount ?? 0n,
          to: args.to ?? args.account,
          eth: args.eth ?? false,
          kind,
          via: info ? (info.fn === "withdraw" ? "claimed" : info.fn === "distribute" ? "sent" : "auto") : undefined,
          sender: info?.from,
          organiserThen: owner,
        });
        break;
      }
      case "PaymentFailed": {
        if (!args.account) break;
        const key = args.account.toLowerCase();
        const kind = moneyKind(args.account);
        // refused in a challenge step: owed as challenge ETH; refused again later: still owed, once
        if (isChallengeTx(tx)) challengeOwed.set(key, (challengeOwed.get(key) ?? 0n) + (args.amount ?? 0n));
        walletOf(args.account).failed.push({ ...at, amount: args.amount ?? 0n, eth: args.eth ?? false, kind });
        break;
      }
      case "Challenged":
        if (args.staker) walletOf(args.staker).challenge = { ...at, fee: args.deposit ?? 0n };
        break;
      case "ChallengeMatched": {
        if (!args.staker) break;
        const c = walletOf(args.staker).challenge;
        const caseId = args.arbitratorDisputeID ?? 0n;
        if (c) c.answer = { kind: "kleros", ...at, matcher: args.matcher, caseId, organiserThen: owner };
        if (args.matcher)
          walletOf(args.matcher).klerosFees.push({
            ...at,
            staker: args.staker,
            amount: c?.fee ?? 0n,
            caseId,
            organiserThen: owner,
          });
        break;
      }
      case "ChallengeResolved": {
        if (!args.staker) break;
        const c = walletOf(args.staker).challenge;
        if (!c) break;
        const resolved = { ...at, attended: args.attended ?? false, ruling: Number(args.ruling ?? 0n) };
        if (c.answer?.kind === "kleros") c.resolved = resolved;
        else
          c.answer = {
            kind:
              info?.fn === "addAttendees"
                ? "added"
                : info?.fn === "resolveChallenge" ||
                    info?.fn === "releasePayouts" ||
                    names.get(tx)?.has("PayoutsReleased")
                  ? "unanswered"
                  : "accepted",
            ...at,
            organiserThen: owner,
          };
        break;
      }
      case "HeldShareSplit": {
        const c = args.staker ? walletOf(args.staker).challenge : undefined;
        if (c)
          c.heldSplit = {
            ...at,
            each: args.each ?? 0n,
            attendees: args.attendees ?? 0n,
            openCases: args.openCases ?? 0n,
          };
        break;
      }
      case "AttendeeAdded": {
        if (!args.attendee) break;
        const how: AttendanceHow =
          resolvedIn.has(`${tx}:${args.attendee.toLowerCase()}`) || names.get(tx)?.has("PayoutsReleased")
            ? "challenge"
            : names.get(tx)?.has("ListClosed")
              ? "closed"
              : record.listClosed
                ? "late"
                : "saved";
        walletOf(args.attendee).added = { ...at, how };
        if (how === "challenge") break;
        const prev = record.attendanceTxs.find((a) => a.tx.toLowerCase() === tx);
        if (prev) prev.wallets.push(args.attendee);
        else record.attendanceTxs.push({ ...at, how, wallets: [args.attendee], by: owner });
        break;
      }
      case "ListClosed":
        record.listClosed = { ...at, by: owner };
        break;
      case "PayoutsReleased":
        record.released = { ...at, share: args.share ?? 0n, by: info?.from, organiserThen: owner };
        break;
      case "Cancelled":
        record.cancelled = { ...at, by: owner };
        break;
    }
  });
  return record;
}

/**
 * How many held shares of lost Kleros cases have been split among the attendees (a split of nothing does not count,
 * as on the guest page); undefined while the record is loading.
 */
export const heldSplitCount = (r?: EventRecord) =>
  r ? [...r.wallets.values()].filter((w) => (w.challenge?.heldSplit?.each ?? 0n) > 0n).length : undefined;

/** The columns of the downloaded record, in order. */
export const RECORD_COLUMNS = [
  ["name", "Name"],
  ["wallet", "Wallet"],
  ["status", "Status"],
  ["deposit", "Deposit"],
  ["depositTx", "Deposit transaction"],
  ["listedTx", "Put on the list transaction"],
  ["refunded", "Refunded"],
  ["paid", "Paid out"],
  ["paymentTxs", "Payment transactions"],
  ["challengeFee", "Challenge fee paid"],
  ["challengeTx", "Challenge transaction"],
  ["answer", "Answer"],
  ["answerTx", "Answer transaction"],
  ["ruling", "Ruling"],
  ["settledTx", "Settled transaction"],
  ["klerosFee", "Kleros fee paid"],
  ["klerosTxs", "Sent to Kleros transactions"],
  ["challengeBack", "Challenge money back"],
  ["challengeTxs", "Challenge money transactions"],
  ["notes", "Notes"],
  ["stepTx", "Event transaction"],
] as const;

export type RecordCsvRow = Partial<Record<(typeof RECORD_COLUMNS)[number][0], string>>;

/** The record as a CSV an organiser can keep or send: one row per wallet, then the event-wide steps. */
export function recordCsv(
  rows: readonly RecordCsvRow[],
  steps: readonly { label: string; detail?: string; tx: string }[],
) {
  const lines = [
    RECORD_COLUMNS.map(([, header]) => header),
    ...rows.map((r) => RECORD_COLUMNS.map(([key]) => r[key] ?? "")),
    ...steps.map((s) =>
      RECORD_COLUMNS.map(([key]) =>
        key === "name" ? s.label : key === "status" ? (s.detail ?? "") : key === "stepTx" ? s.tx : "",
      ),
    ),
  ];
  return lines.map((line) => line.map(csvCell).join(",")).join("\n") + "\n";
}
