import { kickbackAbi } from "@kickback/contracts";
import {
  getAbiItem,
  getAddress,
  hexToBigInt,
  sliceHex,
  toEventSelector,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";

import { checkContract } from "./chain";
import type { Config } from "./config";
import { MONEY_CODES, STATUS, UNREAD_CODES, type IssueCode, type ReturnCode } from "./constants";
import {
  depKey,
  getLogsChunked,
  incomingDeposits,
  isContractCode,
  pairReturns,
  resolveClaims,
  verifyRegistrations,
  type DepositIn,
  type DepositPairing,
  type GuestCheck,
  type IncomingDeposit,
  type LumaRow,
  type ReturnEvent,
} from "./deposits";
import { shortMessage } from "./kickbackError";
import { detectColumns, fmt, fmtEth, lumaDecision, normAddress, uncell, type Columns } from "./text";

export interface ProgressLog {
  info(message: string): void;
  warn(message: string): void;
}
const QUIET: ProgressLog = { info() {}, warn() {} };

export type ListClient = Pick<
  PublicClient,
  "getCode" | "readContract" | "getLogs" | "getBlockNumber" | "getBlock" | "getTransaction" | "getTransactionReceipt"
>;

const V_COLS = [
  "name",
  "email",
  "ticket",
  "approval",
  "onchain",
  "wallet",
  "amount",
  "sent_at",
  "tx",
  "explorer",
  "note",
];
/** Columns of each checkGuests list as CSV (toCsv). */
export const CHECK_COLUMNS = {
  verified: V_COLS,
  issues: ["code", ...V_COLS],
  toReview: V_COLS,
  returns: ["code", "name", "email", "wallet", "to_return", "paid", "tx", "explorer", "note"],
  claims: ["wallet", "email", "name", "code", "approval", "tx"],
  unmatched: ["status", "from", "amount", "to_return", "block", "tx", "explorer", "note"],
} as const;

export interface ReturnRow {
  code: ReturnCode;
  name: string;
  email: string;
  wallet: string;
  /** ETH */
  to_return: string;
  /** wei */
  units: bigint;
  paid: string | undefined;
  tx: string;
  explorer: string | undefined;
  note: string;
}
export interface UnmatchedRow {
  status: string;
  from: Address;
  amount: string;
  to_return: string;
  units: bigint;
  block: number;
  tx: string;
  explorer: string;
  note: string;
}
export interface ListItem {
  wallet: string;
  name: string;
  email: string;
  onchain: string | undefined;
  status: number | undefined;
}
/** A list stamped with what it was made for, so it is refused once out of date. */
export interface StampedList {
  contract: Address;
  chainId: number;
  /** wei */
  deposit: string;
  block: number;
  generatedAt: string;
  items: ListItem[];
}

export interface CheckGuestsResult {
  verified: GuestCheck[];
  issues: GuestCheck[];
  toReview: GuestCheck[];
  returns: ReturnRow[];
  unmatched: UnmatchedRow[];
  claims: GuestCheck[];
  newStakers: GuestCheck[];
  refunds: GuestCheck[];
  lists: { newStakers: StampedList; refunds: StampedList };
  /** verified deposits still held */
  held: GuestCheck[];
  issueCounts: Partial<Record<IssueCode, number>>;
  incoming: IncomingDeposit[];
  totalIncoming: bigint;
  openUnmatched: UnmatchedRow[];
  unbacked: ReturnEvent[];
  unpaired: (ReturnEvent & { left: bigint })[];
  warnings: string[];
  columns: Columns;
  snapshotBlock: number;
  results: GuestCheck[];
  byDeposit: Map<string, DepositPairing>;
  /** lower-case wallet → STATUS at the snapshot (missing: could not be read) */
  statusOf: Map<string, number>;
  /** the attendance list is not posted yet */
  listOpen: boolean;
}

const RETURN_EVENTS = ["Rejected", "Refunded", "StakerRegistered"] as const;
const RETURN_ABI = [
  getAbiItem({ abi: kickbackAbi, name: "Rejected" }),
  getAbiItem({ abi: kickbackAbi, name: "Refunded" }),
  getAbiItem({ abi: kickbackAbi, name: "StakerRegistered" }),
] as const;
const TOPIC_TO_EVENT = new Map(RETURN_ABI.map((e, i) => [toEventSelector(e), RETURN_EVENTS[i]!]));
const LABEL = ["unregistered", "registered", "paid", "refunded"];

/**
 * Checks every Luma registration's pasted deposit on-chain, pairs what the contract already sent back
 * with each wallet's deposits, and sorts the verified payers by the organiser's decision on Luma.
 *   cfg       a normalized config for the contract (cfg.receiver)
 *   rows      the Luma guest export (parseCsv)
 *   scanFrom  the deploy block; undefined scans from block 0 with a warning (only fine on a local chain)
 *   contract  checkContract's result when the caller checked it already
 * Lists: verified, issues, toReview, returns, unmatched, claims (CHECK_COLUMNS), newStakers and
 * refunds, also as stamped lists.
 */
export async function checkGuests({
  client,
  cfg,
  rows,
  scanFrom,
  contract,
  log = QUIET,
}: {
  client: ListClient;
  cfg: Config;
  rows: readonly LumaRow[];
  scanFrom?: number;
  contract?: { contract: Address; depositAmount: bigint };
  log?: ProgressLog;
}): Promise<CheckGuestsResult> {
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    log.warn(m);
  };
  const kickbackAddr = cfg.receiver;
  if (!contract) await checkContract(client, cfg);

  const { results, columns } = await verifyRegistrations(client, cfg, rows);
  log.info(`Columns used: ${JSON.stringify(columns)}`);
  if (!columns.approval) warn("⚠️  No approval_status column: every verified payer is treated as pending.");

  const snapshotBlock = Number(await client.getBlockNumber({ cacheTime: 0 }));
  let from0 = scanFrom;
  if (from0 === undefined) {
    warn('⚠️  No "deployBlock" in the config: scanning from block 0 (only fine on a local test chain).');
    from0 = 0;
  }

  // Every deposit we know of: the ones guests pasted, plus every Deposited event since the start block.
  const perDeposit = new Map<string, IncomingDeposit>();
  for (const t of await incomingDeposits(client, cfg, from0, snapshotBlock)) {
    const k = depKey(t.tx, t.from);
    const d = perDeposit.get(k) ?? { ...t, amount: 0n };
    d.amount += t.amount;
    d.logIndex = Math.min(d.logIndex, t.logIndex);
    perDeposit.set(k, d);
  }
  const incoming = [...perDeposit.values()];
  const deposits: DepositIn[] = [...incoming];
  for (const r of results)
    for (const d of r.deposits ?? [])
      deposits.push({ tx: r.tx, from: d.from, amount: d.amount, block: Number(r.block), logIndex: d.logIndex });

  // On-chain status of every wallet that sent money, at one block
  const statusOf = new Map<string, number>();
  const st = (w: string) => statusOf.get(String(w).toLowerCase());
  const senders = [...new Set(deposits.map((d) => getAddress(d.from)))].filter((w) => w !== zeroAddress);
  for (let i = 0; i < senders.length; i += 10) {
    await Promise.all(
      senders.slice(i, i + 10).map(async (w) => {
        try {
          const s = await client.readContract({
            address: kickbackAddr,
            abi: kickbackAbi,
            functionName: "status",
            args: [w],
            blockNumber: BigInt(snapshotBlock),
          });
          statusOf.set(w.toLowerCase(), Number(s));
        } catch (e) {
          warn(`Could not read status of ${w}: ${shortMessage(e)}`);
        }
      }),
    );
  }

  // What the contract sent back to each wallet, and when it registered them, from the oldest deposit we know of.
  const from = Math.min(from0, ...deposits.map((d) => Number(d.block)).filter(Number.isFinite));
  const returnLogs = await getLogsChunked(
    { getLogs: (range) => client.getLogs({ address: kickbackAddr, events: RETURN_ABI, ...range }) },
    from,
    snapshotBlock,
    cfg.logChunk,
  );
  const events: ReturnEvent[] = returnLogs.map((l) => {
    const type = TOPIC_TO_EVENT.get(l.topics[0]!)!;
    return {
      type,
      wallet: getAddress(sliceHex(l.topics[1]!, 12)),
      amount: type === "StakerRegistered" ? 0n : hexToBigInt(l.data),
      block: Number(l.blockNumber),
      logIndex: l.logIndex ?? 0,
      tx: String(l.transactionHash).toLowerCase(),
    };
  });
  // A registered staker can only be refunded while the event is open (before the attendance list).
  const phase = await client.readContract({
    address: kickbackAddr,
    abi: kickbackAbi,
    functionName: "phase",
    blockNumber: BigInt(snapshotBlock),
  });
  const listOpen = Number(phase) === 0;
  const dep = cfg.depositUnits;
  const { byDeposit, unbacked, unpaired } = pairReturns(deposits, events, {
    deposit: dep,
    prefer: new Set(results.filter((r) => r.code === "VERIFIED").map((r) => r.tx.toLowerCase())),
    stakers: new Set([...statusOf].filter(([, s]) => s === STATUS.Staker || s === STATUS.Paid).map(([w]) => w)),
  });
  const depOf = (r: GuestCheck) => byDeposit.get(depKey(r.tx, r.wallet));
  // money of this row's deposit the contract still holds and nobody has staked
  const freeOf = (r: GuestCheck) => {
    const d = depOf(r);
    return d ? d.remaining - (d.staked ? dep : 0n) : (r.units ?? 0n);
  };
  const held = (r: GuestCheck) => !!depOf(r)?.staked || freeOf(r) >= dep;

  // Several rows claiming one tx or one wallet: keep the real owner, flag the others.
  const { kept, issues } = resolveClaims(results, { isStaker: (w) => st(w) === STATUS.Staker, held });

  const verified: GuestCheck[] = [];
  const newStakers: GuestCheck[] = [];
  const refunds: GuestCheck[] = [];
  const toReview: GuestCheck[] = [];
  const returns: ReturnRow[] = [];
  const STRAY = "'Return a stray transfer'";
  // wallets whose registration is backed by one of their own deposits
  const backed = new Set([...byDeposit.values()].filter((d) => d.staked).map((d) => d.from.toLowerCase()));
  const giveBack = (r: GuestCheck, code: ReturnCode, amount: bigint, note: string) => {
    // a registered wallet with no deposit of its own behind its spot: returning more would dig the hole deeper
    const s = st(r.wallet);
    if (amount <= 0n || ((s === STATUS.Staker || s === STATUS.Paid) && !backed.has(r.wallet.toLowerCase())))
      return false;
    returns.push({
      code,
      name: r.name,
      email: r.email,
      wallet: r.wallet,
      to_return: fmt(amount, cfg.decimals),
      units: amount,
      paid: r.amount,
      tx: r.tx,
      explorer: r.explorer,
      note,
    });
    return true;
  };

  for (const r of kept) {
    const s = st(r.wallet);
    const free = freeOf(r);
    r.onchain = s === undefined ? "unknown" : LABEL[s];
    if (r.code !== "VERIFIED") {
      // the guest's own wallet sent money, but it can't be a deposit (short or late)
      issues.push(r);
      if (s === undefined) continue;
      if (r.code === "AMOUNT_TOO_LOW") {
        if (free === 0n) r.note += " (Already returned.)";
        giveBack(r, "AMOUNT_TOO_LOW", free, "Short deposit: return it and ask for one new payment of the full deposit");
      } else if (r.decision === "declined" && s === STATUS.None && free >= dep) {
        // a declined late payer: rejectAndRefund works for unregistered payers while their money is spare
        refunds.push({ ...r, onchain: "unregistered" });
        r.note += ". Declined: in refunds.json ('Refund declined guests')";
        giveBack(
          r,
          "OVERPAID",
          free - dep,
          `Late and overpaid: the rest after 'Refund declined guests' sends back ${cfg.deposit} ETH`,
        );
      } else {
        giveBack(
          r,
          "OUTSIDE_WINDOW",
          free,
          r.decision === "declined"
            ? "Late payment, declined"
            : "Late payment: it can't be registered. Return it, or decline on Luma so 'Refund declined guests' sends it back",
        );
      }
      continue;
    }

    verified.push(r);
    if (s === STATUS.None && !held(r)) r.onchain = "returned";
    if (s === STATUS.Rejected && held(r)) r.onchain = "refunded, paid again"; // a new deposit after their refund
    let used = 0n; // the part of this deposit a listed action takes (a spot, or the refund of the deposit)
    switch (r.onchain) {
      case "unregistered":
      case "refunded, paid again":
        if (r.decision === "approved") {
          newStakers.push(r);
          used = dep;
        } else if (r.decision === "declined") {
          if (r.onchain === "unregistered") {
            refunds.push(r);
            used = dep;
          } else {
            issues.push({
              ...r,
              code: "PAID_AGAIN_DECLINED",
              note: `Declined, refunded once already, and then paid again. Return the new deposit with ${STRAY} (listed in returns.csv).`,
            });
            giveBack(r, "PAID_AGAIN_DECLINED", free, "Declined, refunded once already, then paid again");
            used = free;
          }
        } else {
          toReview.push(r);
          used = dep;
        }
        break;
      case "returned":
        if (r.decision !== "declined")
          issues.push({
            ...r,
            code: "RETURNED_EARLIER",
            note: `This deposit was already returned (${STRAY}). The guest must send a new ${cfg.deposit} ETH deposit and paste that link before they can be registered.`,
          });
        giveBack(
          r,
          "PARTLY_RETURNED",
          free,
          "Rest of a deposit that was partly returned: it can no longer hold a spot",
        );
        used = free;
        break;
      case "refunded":
        if (r.decision === "approved")
          issues.push({
            ...r,
            code: "REFUNDED_EARLIER",
            note: "Approved now, but this deposit was already refunded. They must send a new deposit before they can be registered.",
          });
        giveBack(r, "PARTLY_RETURNED", free, "Left over from a refunded deposit");
        used = free;
        break;
      case "registered":
        if (!listOpen) {
          // after the list is posted rejectAndRefund refuses stakers (and would revert the whole batch)
          if (r.decision !== "approved")
            issues.push({
              ...r,
              code: "DECLINED_AFTER_LIST",
              note: "Registered, and no longer approved on Luma, but the attendance list is already posted: the deposit stays in the pool. They are paid only if they are on the list. Nothing to do on-chain.",
            });
        } else if (r.decision === "declined")
          refunds.push(r); // rejectAndRefund sends the staked deposit back
        else if (r.decision !== "approved")
          issues.push({
            ...r,
            code: "REGISTERED_NOT_APPROVED",
            note: "Registered on-chain but no longer approved on Luma. Approve again, or decline to refund.",
          });
        break;
      case "paid":
        break;
      default:
        continue; // status unknown: no action, nothing to give back
    }
    // Money beyond one deposit from this tx (an overpayment, or a second deposit of a registered wallet)
    const extra = free - used;
    if (giveBack(r, "OVERPAID", extra, "More than the deposit")) {
      r.note = [
        r.note,
        `overpaid by ${fmt(extra, cfg.decimals)} ETH (return the excess with ${STRAY}; see returns.csv)`,
      ]
        .filter(Boolean)
        .join("; ");
      issues.push({
        ...r,
        code: "OVERPAID",
        note: `${fmt(extra, cfg.decimals)} ETH more than the deposit is still held from this payment. Return the excess with ${STRAY} (listed in returns.csv).`,
      });
    }
  }
  // A second deposit from a wallet already counted for another registration goes back to that wallet.
  for (const i of issues)
    if (i.code === "DUPLICATE_WALLET" && i.extra && st(i.wallet) !== undefined)
      giveBack(i, "DUPLICATE_WALLET", freeOf(i), "Second deposit from a wallet that is already counted");

  // A wallet listed twice, or the zero address, would make the batch revert.
  const listed = [...newStakers, ...refunds].map((v) => v.wallet.toLowerCase());
  if (new Set(listed).size !== listed.length || listed.includes(zeroAddress))
    throw new Error(
      "Internal check failed: a wallet would be listed twice (or is 0x0). Nothing was written; investigate.",
    );

  // Deposits nobody's Luma row points at. A row whose tx came from someone else claims nothing; only a
  // row not checked yet (RPC_ERROR, TX_PENDING, TX_NOT_FOUND) keeps its whole tx out until the next run.
  const claimedDep = new Set(results.filter((r) => MONEY_CODES.has(r.code)).map((r) => depKey(r.tx, r.wallet)));
  const unchecked = new Set(
    [
      ...results.filter((r) => UNREAD_CODES.has(r.code)).map((r) => r.tx),
      ...results.flatMap((r) => r.unread ?? []),
    ].map((t) => String(t).toLowerCase()),
  );
  // Luma answers that mention a deposit's tx, and the ETH addresses guests gave
  const mentions = (tx: string) =>
    rows.filter((row) =>
      Object.values(row).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(tx),
      ),
    );
  const statedBy = new Map<string, LumaRow[]>();
  for (const row of rows) {
    const w = columns.wallet ? normAddress(row[columns.wallet]) : null;
    if (w) statedBy.set(w.toLowerCase(), [...(statedBy.get(w.toLowerCase()) ?? []), row]);
  }
  const rowName = (row: LumaRow) =>
    (columns.email && row[columns.email]) || (columns.name && row[columns.name]) || "a guest";
  const pastedBy = new Map<string, GuestCheck[]>(); // tx → the rows with a sender problem that pasted it
  for (const r of results)
    if (/_SENDER$/.test(r.code)) {
      const k = String(r.tx).toLowerCase();
      pastedBy.set(k, [...(pastedBy.get(k) ?? []), r]);
    }
  const unmatched: UnmatchedRow[] = [];
  for (const t of incoming.filter((x) => !claimedDep.has(depKey(x.tx, x.from)) && !unchecked.has(x.tx))) {
    const d = byDeposit.get(depKey(t.tx, t.from))!;
    const free = d.remaining - (d.staked ? dep : 0n);
    let status = "open";
    let note = "";
    const pasted = pastedBy.get(t.tx);
    if (free <= 0n)
      status = d.staked ? "held for a registered staker" : `already refunded (${[...new Set(d.returnedBy)].join(" ")})`;
    else if (isContractCode(await client.getCode({ address: t.from })))
      note =
        "Sent by a contract (an exchange, a Safe or another smart wallet?): check where it should go before returning it.";
    else if (free < t.amount) note = `Partly returned already (${[...new Set(d.returnedBy)].join(" ")}).`;
    if (free > 0n && !pasted) {
      const seen = mentions(t.tx);
      const owners = statedBy.get(t.from.toLowerCase()) ?? [];
      if (seen.length)
        note = [
          `This tx link is in the Luma answers of ${seen.map(rowName).join(", ")}: ask them about it before returning it (it may be their deposit).`,
          note,
        ]
          .filter(Boolean)
          .join(" ");
      else if (owners.length)
        note = [
          `Sent from the ETH address ${owners.map(rowName).join(", ")} gave on Luma: ask them for this tx link instead of returning it.`,
          note,
        ]
          .filter(Boolean)
          .join(" ");
    }
    if (free > 0n && pasted)
      note = [
        `Pasted on Luma by ${pasted.map((r) => `${r.email || r.name} (${r.code})`).join(", ")}: sort that out with the guest first ` +
          `(if the sender is their own wallet, they put it as their ETH address on Luma and it verifies). Return it only once that's agreed.`,
        note,
      ]
        .filter(Boolean)
        .join(" ");
    unmatched.push({
      status,
      from: t.from,
      amount: fmt(t.amount, cfg.decimals),
      to_return: fmt(free > 0n ? free : 0n, cfg.decimals),
      units: free > 0n ? free : 0n,
      block: t.block,
      tx: t.tx,
      explorer: `${cfg.explorer}/tx/${t.tx}`,
      note,
    });
  }

  // every row whose tx verified as its wallet's deposit, duplicates included: a check-in through any of them counts
  const claims = [...verified, ...issues.filter((i) => i.was === "VERIFIED" && /^DUPLICATE_/.test(i.code))].map(
    (r): GuestCheck => ({ ...r, code: r.was ? r.code : "VERIFIED" }),
  );
  const stamp = {
    contract: kickbackAddr,
    chainId: Number(cfg.chainId),
    deposit: dep.toString(),
    block: snapshotBlock,
    generatedAt: new Date().toISOString(),
  };
  const STATUS_OF: Record<string, number> = { unregistered: 0, registered: 1, "refunded, paid again": 3 };
  const item = (v: GuestCheck): ListItem => ({
    wallet: v.wallet,
    name: v.name,
    email: v.email,
    onchain: v.onchain,
    status: v.onchain === undefined ? undefined : STATUS_OF[v.onchain],
  });

  for (const u of unbacked)
    warn(
      `⚠️  ${u.wallet} was registered (tx ${u.tx}) while none of its own deposits was left in the contract: its spot is backed by someone else's money. Investigate before refunding anyone.`,
    );
  for (const u of unpaired)
    warn(
      `⚠️  ${fmtEth(u.left)} sent back to ${u.wallet} (tx ${u.tx}) matches no deposit seen from that wallet: either its deposit is ` +
        `older than the scanned range (check --scan-from-block / deployBlock), or that wallet got back more than it sent (someone else's money).`,
    );

  const openUnmatched = unmatched.filter((u) => u.status === "open");
  return {
    verified,
    issues,
    toReview,
    returns,
    unmatched,
    claims,
    newStakers,
    refunds,
    lists: { newStakers: { ...stamp, items: newStakers.map(item) }, refunds: { ...stamp, items: refunds.map(item) } },
    held: verified.filter((v) =>
      ["unregistered", "registered", "paid", "refunded, paid again"].includes(v.onchain ?? ""),
    ),
    issueCounts: issues.reduce<Partial<Record<IssueCode, number>>>(
      (m, i) => ((m[i.code] = (m[i.code] ?? 0) + 1), m),
      {},
    ),
    incoming,
    totalIncoming: incoming.reduce((s, t) => s + t.amount, 0n),
    openUnmatched,
    unbacked,
    unpaired,
    warnings,
    columns,
    snapshotBlock,
    results,
    byDeposit,
    statusOf,
    listOpen,
  };
}

export interface OverviewRow {
  tx: string;
  from: Address;
  /** wei */
  amount: bigint;
  block: number;
  sentAt: string;
  explorer: string;
  /** unregistered, registered, paid, refunded, returned, "refunded, paid again" or unknown */
  status: string;
  /** wei of it the contract still holds, net of returns */
  held: bigint;
  /** VERIFIED, or why not */
  code: string;
  note: string;
  /** the contract still holds a whole deposit of this payment for a spot (staked, or not returned) */
  heldForSpot: boolean;
  /** registerStakers accepts the wallet for this deposit (only before the attendance list) */
  canRegister: boolean;
  /** rejectAndRefund sends this deposit back */
  canRefund: boolean;
}

/**
 * Every deposit the contract received since `scanFrom`, for a Deposits table with no Luma export:
 * each deposit is checked by checkGuests as if its sender registered with it and were pending, so the
 * same rules decide. One row per deposit (one wallet in one tx), oldest first. Money beyond one deposit
 * is in `returns`. `check` is the whole checkGuests result (null when no deposit came in yet).
 */
export async function depositsOverview({
  client,
  cfg,
  scanFrom,
  contract,
  log = QUIET,
}: {
  client: ListClient;
  cfg: Config;
  scanFrom?: number;
  contract?: { contract: Address; depositAmount: bigint };
  log?: ProgressLog;
}): Promise<{ deposits: OverviewRow[]; returns: ReturnRow[]; check: CheckGuestsResult | null }> {
  const c = contract ?? (await checkContract(client, cfg));
  const incoming = await incomingDeposits(client, cfg, scanFrom ?? 0);
  if (!incoming.length) return { deposits: [], returns: [], check: null };
  // one registration per deposit tx, with no ETH address: the wallet is the sender
  const rows = [...new Set(incoming.map((d) => d.tx))].map((tx) => ({
    name: "",
    email: "",
    ticket_name: "deposit",
    approval_status: "pending_approval",
    eth_address: "",
    tx,
  }));
  const check = await checkGuests({
    client,
    cfg: { ...cfg, columns: {}, depositTicketPattern: "deposit" },
    rows,
    ...(scanFrom === undefined ? {} : { scanFrom }),
    contract: c,
    log,
  });
  const reviewable = new Set(check.toReview.map((r) => depKey(r.tx, r.wallet)));
  const byKey = new Map<string, GuestCheck>();
  for (const r of [...check.verified, ...check.issues, ...check.toReview])
    if (r.wallet && !byKey.has(depKey(r.tx, r.wallet))) byKey.set(depKey(r.tx, r.wallet), r);
  const out: OverviewRow[] = [];
  for (const d of incoming) {
    const key = depKey(d.tx, d.from);
    const prev = out.find((o) => depKey(o.tx, o.from) === key);
    if (prev) {
      prev.amount += d.amount; // several Deposited events of one wallet in one tx
      continue;
    }
    const r: Partial<GuestCheck> = byKey.get(key) ?? check.results.find((x) => x.tx === d.tx) ?? {};
    const pairing = check.byDeposit.get(key);
    const s = check.statusOf.get(d.from.toLowerCase());
    const status = r.onchain ?? (s === undefined ? "unknown" : LABEL[s]!);
    out.push({
      tx: d.tx,
      from: d.from,
      amount: d.amount,
      block: d.block,
      sentAt: r.sent_at ?? "",
      explorer: `${cfg.explorer}/tx/${d.tx}`,
      status,
      held: pairing ? pairing.remaining : 0n,
      code: r.code ?? "",
      note: r.note ?? "",
      heldForSpot: !!pairing && (pairing.staked || pairing.remaining >= cfg.depositUnits),
      canRegister: reviewable.has(key) && check.listOpen,
      canRefund:
        (reviewable.has(key) && status === "unregistered") ||
        (r.code === "VERIFIED" && status === "registered" && check.listOpen),
    });
  }
  return { deposits: out, returns: check.returns, check };
}

export const PAYOUT_COLUMNS = ["name", "email", "wallet", "attended", "payout"] as const;

export interface Attendee {
  wallet: Address;
  name: string;
  email: string;
  emails: Set<string>;
}
/** What postAttendance sends. */
export interface PayoutPlan {
  contract: Address;
  chainId: number;
  stakers: number;
  attendees: Address[];
  /** wei: what postAttendance must be given */
  share: string;
  shareEth: string;
}
export interface BuildPayoutResult {
  contract: Address;
  stakers: Address[];
  attendees: Attendee[];
  noShows: Attendee[];
  deposit: bigint;
  pool: bigint;
  share: bigint;
  dust: bigint;
  plan: PayoutPlan;
  payoutRows: (Attendee & { attended: "yes" | "no"; payout: string })[];
  summaryMarkdown: string;
  door: { rows: number; unmatched: { email: string; wallet: Address | null }[] } | null;
  /** approved, verified, not registered */
  missing: Address[];
  /** registered stakers no verified registration names: counted as no-shows, the caller decides */
  unknown: Address[];
  unknownNote: string;
}

/** Rows that name a wallet and a registration (verified or claims rows of checkGuests, or their CSVs). */
export interface RegistrationRow {
  wallet: string;
  name?: string;
  email?: string;
  approval?: string;
}

/**
 * Matches Luma check-ins against the stakers registered in the contract (the source of truth) and
 * computes the share per attendee. A check-in counts only through the guest's own registration
 * (their email), never through a wallet typed into somebody else's row; a door list (`extra`) may
 * also name wallets. `checkins` null goes by the door list alone.
 */
export async function buildPayout({
  client,
  cfg,
  checkins,
  verified = [],
  claims = [],
  extra,
  extraName = "the door list",
  title = "Truth Pays",
  log = QUIET,
}: {
  client: Pick<PublicClient, "readContract">;
  cfg: Pick<Config, "contract" | "columns" | "depositUnits" | "deposit" | "chainId" | "explorer">;
  checkins: readonly LumaRow[] | null;
  verified?: readonly RegistrationRow[];
  claims?: readonly RegistrationRow[];
  extra?: readonly LumaRow[];
  extraName?: string;
  title?: string;
  log?: ProgressLog;
}): Promise<BuildPayoutResult> {
  if (!cfg.contract)
    throw new Error('Set "contract" in the config: the stakers and the pool are read from the deployed contract.');
  if (!checkins && !extra) throw new Error("Give the Luma export after the event, a door list, or both.");
  const checkedEmails = new Set<string>();
  const checkedWallets = new Set<string>(); // only from the organiser's own door list
  if (checkins) {
    const col = detectColumns(Object.keys(checkins[0] ?? {}), cfg.columns);
    if (!col.checkedIn) throw new Error("No checked_in_at column found in the Luma export");
    if (!col.email) throw new Error("No email column found in the Luma export");
    for (const r of checkins) {
      if (!(r[col.checkedIn] ?? "").trim()) continue;
      const email = r[col.email];
      if (email) checkedEmails.add(email.toLowerCase().trim());
    }
  }
  let extraRows: { email: string; wallet: Address | null }[] = [];
  if (extra) {
    const xc = detectColumns(Object.keys(extra[0] ?? {}), {});
    if (!xc.email && !xc.wallet) throw new Error(`${extraName}: needs an "email" or "wallet" column`);
    extraRows = extra.map((r) => ({
      email: ((xc.email ? r[xc.email] : undefined) ?? "").toLowerCase().trim(),
      wallet: xc.wallet ? normAddress(r[xc.wallet]) : null,
    }));
    for (const r of extraRows) {
      if (r.email) checkedEmails.add(r.email);
      if (r.wallet) checkedWallets.add(r.wallet);
    }
  }

  // Stakers and the deposit come from the contract (the source of truth)
  const contractAddr = getAddress(cfg.contract.toLowerCase());
  const read = { address: contractAddr, abi: kickbackAbi } as const;
  const all = await client.readContract({ ...read, functionName: "stakers" });
  const st = await Promise.all(all.map((w) => client.readContract({ ...read, functionName: "status", args: [w] })));
  const stakerWallets = [...new Set(all.filter((_, i) => Number(st[i]) === STATUS.Staker).map((w) => getAddress(w)))];
  const count = await client.readContract({ ...read, functionName: "stakerCount" });
  if (BigInt(stakerWallets.length) !== count)
    throw new Error(
      `On-chain staker list (${stakerWallets.length}) and stakerCount (${count}) disagree; stop and investigate`,
    );
  const deposit = await client.readContract({ ...read, functionName: "depositAmount" });
  if (deposit !== cfg.depositUnits)
    log.warn(
      `⚠️  The contract's deposit is ${fmt(deposit)} ETH but the config says ${cfg.deposit} ETH: using the contract's amount. Fix "deposit" in the config.`,
    );
  const approved = verified
    .filter((v) => lumaDecision(v.approval) === "approved")
    .map((v) => getAddress(v.wallet.toLowerCase()));
  const missing = [...new Set(approved)].filter((w) => !stakerWallets.includes(w));
  if (missing.length)
    log.warn(
      `⚠️  ${missing.length} approved wallets with a verified deposit are NOT registered on-chain and can't be paid: ${missing.join(", ")}`,
    );

  // wallet → its name and email (verified first) and every email whose registration verified it
  const byWallet = new Map<Address, { name: string; email: string; emails: Set<string> }>();
  for (const v of [...verified, ...claims]) {
    const w = normAddress(v.wallet);
    if (!w) continue;
    const email = uncell(v.email).toLowerCase().trim();
    const e = byWallet.get(w) ?? { name: uncell(v.name), email, emails: new Set<string>() };
    if (email) e.emails.add(email);
    byWallet.set(w, e);
  }
  const unknown = stakerWallets.filter((w) => !byWallet.has(w));
  const unknownNote = unknown.length
    ? `${unknown.length} registered stakers have no Luma registration that verified their wallet, so their check-in cannot be matched: ${unknown.join(", ")}`
    : "";
  const attendees: Attendee[] = [];
  const noShows: Attendee[] = [];
  for (const w of stakerWallets) {
    const v = byWallet.get(w);
    const showed = checkedWallets.has(w) || (!!v && [...v.emails].some((e) => checkedEmails.has(e)));
    (showed ? attendees : noShows).push({
      wallet: w,
      name: v?.name ?? "",
      email: v?.email ?? "",
      emails: v?.emails ?? new Set(),
    });
  }

  const n = BigInt(stakerWallets.length);
  const pool = deposit * n;
  const share = attendees.length ? pool / BigInt(attendees.length) : 0n;
  const dust = pool - share * BigInt(attendees.length);
  if (
    attendees.length &&
    (await client.readContract({ ...read, functionName: "previewShare", args: [BigInt(attendees.length)] })) !== share
  )
    throw new Error(
      "The contract computes a different share for this list; stop and investigate (is the config on the right contract?)",
    );

  let door: BuildPayoutResult["door"] = null;
  if (extraRows.length) {
    const staff = new Set<string>(attendees.flatMap((x) => [...x.emails, x.wallet]));
    door = {
      rows: extraRows.length,
      unmatched: extraRows.filter((r) => !staff.has(r.email) && !(r.wallet && staff.has(r.wallet))),
    };
  }
  const plan: PayoutPlan = {
    contract: contractAddr,
    chainId: Number(cfg.chainId),
    stakers: stakerWallets.length,
    attendees: attendees.map((x) => x.wallet),
    share: share.toString(),
    shareEth: fmt(share),
  };
  const payoutRows = [
    ...attendees.map((x) => ({ ...x, attended: "yes" as const, payout: fmt(share) })),
    ...noShows.map((x) => ({ ...x, attended: "no" as const, payout: "0" })),
  ];
  const summaryMarkdown = `# ${title}: deposit settlement

| | |
|---|---|
| Stakers | ${stakerWallets.length} |
| Showed up | ${attendees.length} |
| No-shows | ${noShows.length} |
| Pool | ${fmtEth(pool)} |
| Payout per attendee (if nobody is added by a challenge) | ${fmtEth(share)} (deposit ${fmtEth(deposit)} + ${fmtEth(share > deposit ? share - deposit : 0n)} bonus) |
| Rounding dust | ${fmt(dust)} ETH |
| Contract | ${cfg.explorer}/address/${contractAddr} |
`;
  return {
    contract: contractAddr,
    stakers: stakerWallets,
    attendees,
    noShows,
    deposit,
    pool,
    share,
    dust,
    plan,
    payoutRows,
    summaryMarkdown,
    door,
    missing,
    unknown,
    unknownNote,
  };
}
