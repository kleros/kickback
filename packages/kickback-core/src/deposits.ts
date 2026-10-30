import { kickbackAbi } from "@kickback/contracts";
import {
  getAbiItem,
  getAddress,
  hexToBigInt,
  pad,
  sliceHex,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";

import type { Config } from "./config";
import {
  DEFAULT_LOG_CHUNK,
  DEPOSITED_TOPIC,
  MONEY_CODES,
  TOKEN_TRANSFER_TOPIC,
  UNREAD_CODES,
  type IssueCode,
} from "./constants";
import { shortMessage } from "./kickbackError";
import {
  detectColumns,
  extractTxHash,
  extractTxHashes,
  fmt,
  lumaDecision,
  normAddress,
  type Columns,
  type LumaDecision,
} from "./text";

/** Code of a contract, not of a plain wallet (an EIP-7702 delegated wallet is still a plain wallet). */
export const isContractCode = (code: Hex | undefined | null): boolean =>
  !!code && code !== "0x" && !/^0xef0100[0-9a-f]{40}$/i.test(code);

/** One deposit = the ETH one wallet sent to the contract in one tx (its Deposited events, added up). */
export const depKey = (tx: string, from: string): string => `${String(tx).toLowerCase()}|${String(from).toLowerCase()}`;

/** Explorers of other networks: a tx link from one of them means the ETH was sent on the wrong network. */
export const OTHER_NETWORKS: readonly (readonly [RegExp, string])[] = [
  [/sepolia\.etherscan\.io/i, "the Sepolia test network"],
  [/holesky\.etherscan\.io|hoodi\.etherscan\.io/i, "an Ethereum test network"],
  [/optimistic\.etherscan\.io|optimism/i, "Optimism"],
  [/arbiscan\.io|arbitrum/i, "Arbitrum"],
  [/basescan\.org|base\.blockscout/i, "Base"],
  [/polygonscan\.com/i, "Polygon"],
  [/lineascan\.build/i, "Linea"],
  [/scrollscan\.com/i, "Scroll"],
  [/bscscan\.com/i, "BNB Chain"],
  [/zksync/i, "zkSync"],
  [/blastscan\.io/i, "Blast"],
  [/gnosisscan\.io/i, "Gnosis"],
];
/** The network a pasted tx link points at, if it is clearly not Ethereum mainnet ("Arbitrum"…). */
export function otherNetworkOf(link: unknown): string | null {
  const s = String(link ?? "");
  return OTHER_NETWORKS.find(([re]) => re.test(s))?.[1] ?? null;
}

/** The fields of a log this file reads (viem's Log has them all). */
export interface RawLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number | null;
}

export interface SenderDeposit {
  from: Address;
  amount: bigint;
  logIndex: number;
}

/** The contract's Deposited events in a list of logs, added up per sender. */
export function depositsInLogs(logs: readonly RawLog[], receiver: Address): Map<Address, SenderDeposit> {
  const bySender = new Map<Address, SenderDeposit>();
  for (const l of logs) {
    if (getAddress(l.address) !== receiver || l.topics[0] !== DEPOSITED_TOPIC || l.topics.length !== 2) continue;
    const from = getAddress(sliceHex(l.topics[1]!, 12));
    const index = l.logIndex ?? 0;
    const d = bySender.get(from) ?? { from, amount: 0n, logIndex: index };
    d.amount += hexToBigInt(l.data);
    d.logIndex = Math.min(d.logIndex, index);
    bySender.set(from, d);
  }
  return bySender;
}

export interface TxCheck {
  ok: boolean;
  code: IssueCode;
  note: string;
  /** The amount per sender in this tx, whenever ETH arrived in the contract. */
  deposits?: SenderDeposit[];
  block?: number;
  sender?: Address;
  wallet?: Address;
  inferred?: boolean;
  amount?: bigint;
  /** Block timestamp, unix seconds. */
  ts?: number;
  logIndex?: number;
}

export type VerifyClient = Pick<PublicClient, "getTransactionReceipt" | "getTransaction" | "getCode" | "getBlock">;
export type VerifyConfig = Pick<
  Config,
  "receiver" | "opensAt" | "deadline" | "depositUnits" | "deposit" | "decimals"
> & {
  chainName?: string;
};

// viem throws TransactionReceiptNotFoundError / TransactionNotFoundError for an unknown hash
const orNull = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch (e) {
    if (e instanceof TransactionReceiptNotFoundError || e instanceof TransactionNotFoundError) return null;
    throw e;
  }
};

/**
 * Verifies one deposit transaction: valid when it succeeded on this chain, the deposit contract
 * (`receiver`) logged a Deposited event for the guest's wallet, totalling ≥ deposit, inside the
 * deposit window. `link` is what the guest pasted, used to name the network when the tx is not on this chain.
 */
export async function verifyTx(
  client: VerifyClient,
  cfg: VerifyConfig,
  txHash: string,
  claimedWallet: Address | null,
  link = "",
): Promise<TxCheck> {
  const net = cfg.chainName ?? "this network";
  const hash = txHash as Hash;
  const receipt = await orNull(client.getTransactionReceipt({ hash }));
  if (!receipt) {
    if (await orNull(client.getTransaction({ hash })))
      return { ok: false, code: "TX_PENDING", note: "Sent but not confirmed yet. Check again later." };
    const other = otherNetworkOf(link);
    if (other)
      return {
        ok: false,
        code: "WRONG_NETWORK",
        note: `The link is a transaction on ${other}, not ${net}. ETH sent there never reached the deposit contract, and the contract can't send it back. Ask the guest to send a new deposit on ${net} and paste its etherscan.io link.`,
      };
    return {
      ok: false,
      code: "TX_NOT_FOUND",
      note: `Not found on ${net}. Sent on another network (Arbitrum, Base, Optimism…), or a typo in the link? Ask the guest for their etherscan.io link.`,
    };
  }
  const toContract = !!receipt.to && getAddress(receipt.to) === cfg.receiver;
  if (receipt.status !== "success") {
    // Running out of gas uses up the whole limit; a refusal (0 ETH, deposits closed) returns the rest.
    const tx = toContract ? await orNull(client.getTransaction({ hash })) : null;
    if (tx && receipt.gasUsed >= tx.gas)
      return {
        ok: false,
        code: "TX_FAILED",
        note: `Sent with too little gas (a limit of ${Number(tx.gas).toLocaleString("en-US")}): the deposit contract needs about 25,000 to record a deposit, so the transaction failed and no ETH moved. The guest only paid the network fee. Ask them to send it again from the deposit page, or from their wallet with the gas limit it suggests (not a fixed 21,000).`,
      };
    return {
      ok: false,
      code: "TX_FAILED",
      note: toContract
        ? "The deposit contract refused this payment (0 ETH sent, or deposits were already closed), so no ETH arrived: the guest only paid the network fee. If they still want a spot, they send a new deposit."
        : "This transaction failed, so no ETH moved: the guest only paid the network fee. If they still want a spot, they send a new deposit.",
    };
  }

  const bySender = depositsInLogs(receipt.logs, cfg.receiver);
  if (!bySender.size) {
    const receiverTopic = pad(cfg.receiver, { size: 32 }).toLowerCase();
    const token = receipt.logs.find(
      (l) =>
        l.topics.length === 3 && l.topics[0] === TOKEN_TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === receiverTopic,
    );
    if (token)
      return {
        ok: false,
        code: "NO_DEPOSIT_TRANSFER",
        note: `This sent a token (USDC, for example), not ETH, to the deposit contract (token contract ${getAddress(token.address)}). A token is never a deposit: give it back with 'Return tokens sent by mistake' in the console (it shows the amount), and ask the guest for a new deposit in ETH.`,
      };
    return {
      ok: false,
      code: "NO_DEPOSIT_TRANSFER",
      note:
        toContract || !receipt.to
          ? "No ETH deposit to the deposit contract in this tx"
          : `No ETH deposit to the deposit contract in this tx (it went to ${getAddress(receipt.to)}: wrong address?)`,
    };
  }

  const deposits = [...bySender.values()];
  const senders = deposits.map((d) => d.from);
  const seen = { deposits, block: Number(receipt.blockNumber) };
  let wallet = claimedWallet;
  let inferred = false;
  if (!wallet) {
    if (senders.length !== 1)
      return { ok: false, code: "AMBIGUOUS_SENDER", note: "No wallet given and tx has several senders", ...seen };
    wallet = senders[0]!;
    inferred = true;
    // Refunds and payouts would go to whoever sent the ETH: a contract only if the guest says it is theirs.
    if (isContractCode(await client.getCode({ address: wallet })))
      return {
        ok: false,
        code: "UNUSUAL_SENDER",
        note: `Sent by a contract (${wallet}: an exchange, a Safe or another smart wallet?) and no ETH address on Luma. Ask the guest which wallet should get refunds and payouts: if it is that same Safe or smart wallet, they add its address on Luma as their ETH address.`,
        sender: wallet,
        ...seen,
      };
  }
  if (wallet === zeroAddress)
    return {
      ok: false,
      code: "UNUSUAL_SENDER",
      note: "The ETH address on Luma is the zero address. Ask the guest for their real wallet.",
      ...seen,
    };
  const mine = bySender.get(wallet);
  if (!mine)
    return {
      ok: false,
      code: "WRONG_SENDER",
      note: `Deposit came from ${senders.join(" / ")}, not ${wallet} (sent from an exchange? Refunds and payouts can only go to the wallet that sent the deposit)`,
      sender: senders[0]!,
      ...seen,
    };

  const amount = mine.amount;
  const ts = Number((await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp);
  const res = { wallet, inferred, amount, ts, logIndex: mine.logIndex, ...seen };
  if (ts < cfg.opensAt || ts > cfg.deadline)
    return { ok: false, code: "OUTSIDE_WINDOW", note: `Sent at ${new Date(ts * 1000).toISOString()}`, ...res };
  if (amount < cfg.depositUnits)
    return {
      ok: false,
      code: "AMOUNT_TOO_LOW",
      note: `Sent ${fmt(amount, cfg.decimals)} ETH, need ${cfg.deposit} ETH. A second payment can't be added to it: return this one (returns.csv) and ask for one new ${cfg.deposit} ETH deposit.`,
      ...res,
    };
  return { ok: true, code: "VERIFIED", note: inferred ? "wallet taken from the transaction sender" : "", ...res };
}

/** One Luma row's check (verifyRegistrations), as later lists carry it. */
export interface GuestCheck {
  name: string;
  email: string;
  ticket: string;
  approval: string;
  decision: LumaDecision;
  wallet: string;
  tx: string;
  ok: boolean;
  code: IssueCode;
  note: string;
  inferred?: boolean;
  deposits?: SenderDeposit[];
  /** wei sent by the row's wallet in its tx */
  units?: bigint;
  logIndex?: number;
  /** ETH, as text */
  amount?: string;
  sent_at?: string;
  /** Other pasted links that could not be read yet. */
  unread?: string[];
  explorer?: string;
  block?: number;
  /** On-chain status at the snapshot (checkGuests). */
  onchain?: string;
  /** The row's own check code, when a later rule flagged it. */
  was?: IssueCode;
  /** A duplicate wallet whose extra deposit is returned. */
  extra?: boolean;
}

export type LumaRow = Record<string, string>;

/** Checks every deposit registration of a Luma export on-chain, each row on its own. */
export async function verifyRegistrations(
  client: VerifyClient,
  cfg: VerifyConfig & Pick<Config, "columns" | "explorer"> & { depositTicketPattern?: string },
  rows: readonly LumaRow[],
  { onlyDepositTicket = true } = {},
): Promise<{ results: GuestCheck[]; columns: Columns }> {
  const headers = rows.length ? Object.keys(rows[0]!) : [];
  const col = detectColumns(headers, cfg.columns);
  if (!col.tx)
    throw new Error(`Couldn't find the tx-link column. Headers: ${headers.join(" | ")}. Set config.columns.tx`);
  const get = (r: LumaRow, c: string | undefined) => (c === undefined ? undefined : r[c]);

  const ticketRe = new RegExp(cfg.depositTicketPattern ?? "deposit|commit|stake", "i");
  const cache = new Map<string, Promise<TxCheck>>();
  const results: GuestCheck[] = [];
  for (const r of rows) {
    const who = { name: get(r, col.name) ?? "", email: (get(r, col.email) ?? "").toLowerCase().trim() };
    const isDepositTicket = col.ticket ? ticketRe.test(get(r, col.ticket) ?? "") : true;
    const rawTx = (get(r, col.tx) ?? "").trim();
    const txHash = extractTxHash(rawTx);
    // free "Request to Join" guest: skip unless they pasted an actual tx hash
    if (onlyDepositTicket && col.ticket && !isDepositTicket && !txHash) continue;

    const claimed = col.wallet ? normAddress(get(r, col.wallet)) : null;
    const approval = (col.approval ? (get(r, col.approval) ?? "") : "").toLowerCase().trim();
    const base = {
      ...who,
      ticket: get(r, col.ticket) ?? "",
      approval,
      decision: lumaDecision(approval),
      wallet: claimed ?? "",
      tx: txHash ?? rawTx,
    };

    if (!rawTx) {
      results.push({ ...base, ok: false, code: "NO_TX", note: "Deposit ticket but no tx link" });
      continue;
    }
    if (!txHash) {
      results.push({ ...base, ok: false, code: "BAD_TX_HASH", note: "Couldn't find a 0x… tx hash in the answer" });
      continue;
    }

    const check = (h: string): Promise<TxCheck> => {
      const key = `${h}|${claimed ?? ""}|${otherNetworkOf(rawTx) ?? ""}`;
      let p = cache.get(key);
      if (!p) {
        p = verifyTx(client, cfg, h, claimed, rawTx).catch((e: unknown): TxCheck => ({
          ok: false,
          code: "RPC_ERROR",
          note: shortMessage(e),
        }));
        cache.set(key, p);
      }
      return p;
    };
    // Several links in one answer: use the one that is this guest's deposit; more than one, a person decides.
    let txUsed = txHash;
    let res = await check(txHash);
    let unread: string[] = [];
    const hashes = extractTxHashes(rawTx);
    if (hashes.length > 1) {
      const checked = await Promise.all(hashes.map(async (h) => ({ h, res: await check(h) })));
      const good = checked.filter((c) => c.res.ok);
      const money = checked.filter((c) => MONEY_CODES.has(c.res.code));
      // a link that could not be read this run may be the deposit: say so rather than an earlier link's failure
      const notYet = checked.filter((c) => UNREAD_CODES.has(c.res.code));
      unread = notYet.map((c) => c.h);
      const pick = good[0] ?? money[0] ?? notYet.find((c) => c.res.code !== "TX_NOT_FOUND") ?? checked[0]!;
      txUsed = pick.h;
      res = pick.res;
      if (good.length > 1)
        res = {
          ...res,
          ok: false,
          code: "MULTIPLE_TX",
          note: `Pasted ${good.length} deposits that each verify (${good.map((c) => c.h).join(", ")}). Ask the guest which one is their deposit, then keep that link on Luma: the other is listed in unmatched.csv to give back.`,
        };
      else
        res = {
          ...res,
          note: [res.note, `${hashes.length} tx links pasted; checked ${txUsed}`].filter(Boolean).join("; "),
        };
    }
    results.push({
      ...base,
      ok: res.ok,
      inferred: !!res.inferred,
      deposits: res.deposits ?? [],
      units: res.amount,
      logIndex: res.logIndex,
      wallet: res.wallet ?? claimed ?? "",
      amount: res.amount !== undefined ? fmt(res.amount, cfg.decimals) : "",
      sent_at: res.ts ? new Date(res.ts * 1000).toISOString() : "",
      tx: txUsed,
      unread,
      explorer: cfg.explorer ? `${cfg.explorer}/tx/${txUsed}` : "",
      block: res.block,
      code: res.code,
      note: [res.note, res.inferred && res.code !== "VERIFIED" ? "wallet taken from the transaction sender" : ""]
        .filter(Boolean)
        .join("; "),
    });
  }
  return { results, columns: col };
}

/**
 * Several Luma rows can point at the same deposit or wallet: picks the row that really owns it, so a
 * copy never knocks out the real guest. A declined row never wins over one that is not; for one tx,
 * a row whose stated wallet sent it beats a blank-address row whose wallet is registered, which beats
 * other blank-address rows; a not-declined WRONG_SENDER row blocks plain blank-address rows; for one
 * wallet, a row whose deposit still backs a spot (`held`) wins; several equals not declined are all
 * DUPLICATE_CLAIM. Losers are issues with no on-chain action; flagged rows keep their check in `was`.
 */
export function resolveClaims(
  results: readonly GuestCheck[],
  {
    isStaker = (_w: string) => false,
    held = (_r: GuestCheck) => true,
  }: { isStaker?: (w: string) => boolean; held?: (r: GuestCheck) => boolean } = {},
): { kept: GuestCheck[]; issues: GuestCheck[] } {
  const issues: GuestCheck[] = [];
  const who = (r: GuestCheck | undefined) => r?.email || r?.name || r?.wallet || "another guest";
  const live = (r: GuestCheck) => r.decision !== "declined";
  const flag = (r: GuestCheck, code: IssueCode, note: string, extra = false) =>
    issues.push({ ...r, was: r.code, code, note, extra });
  const pick = (pool: GuestCheck[]): { keep: GuestCheck | null; conflict: GuestCheck[] } => {
    if (pool.length <= 1) return { keep: pool[0] ?? null, conflict: [] };
    const notDeclined = pool.filter(live);
    if (notDeclined.length === 1) return { keep: notDeclined[0]!, conflict: [] };
    if (!notDeclined.length) return { keep: pool[0]!, conflict: [] };
    return { keep: null, conflict: notDeclined };
  };
  const copyNote = (r: GuestCheck, owner: GuestCheck | undefined) =>
    `Same tx already claimed by ${who(owner)}. No on-chain action for this registration${live(r) ? "; if it is a copy, decline it on Luma" : ""}.`;

  // 1. rows pointing at the same tx
  const stage: GuestCheck[] = [];
  const byTx = new Map<string, GuestCheck[]>();
  for (const r of results) {
    if (!/0x[a-fA-F0-9]{64}/.test(r.tx)) {
      issues.push(r); // NO_TX / BAD_TX_HASH
      continue;
    }
    const k = r.tx.toLowerCase();
    if (!byTx.has(k)) byTx.set(k, []);
    byTx.get(k)!.push(r);
  }
  for (const group of byTx.values()) {
    if (group.length === 1) {
      (MONEY_CODES.has(group[0]!.code) ? stage : issues).push(group[0]!);
      continue;
    }
    const claimants = group.filter((r) => MONEY_CODES.has(r.code));
    const blocker = group.find((r) => r.code === "WRONG_SENDER" && live(r));
    const blocked = !!blocker;
    // 1: the stated ETH address sent it; 2: blank address, but that wallet is registered; 3: blank address
    const tier = (r: GuestCheck) => (!r.inferred ? 1 : isStaker(r.wallet) ? 2 : 3);
    const owners: GuestCheck[] = [];
    for (const w of new Set(claimants.map((r) => r.wallet))) {
      const mine = claimants.filter((r) => r.wallet === w);
      const eligible = mine.filter((r) => !(blocked && tier(r) === 3));
      if (!eligible.length) {
        for (const r of mine)
          flag(
            r,
            "DUPLICATE_CLAIM",
            `${who(blocker)} pasted the same tx with an ETH address that did not send it, and this registration has no ETH address. Decide by hand which one is real, and decline the other on Luma.`,
          );
        continue;
      }
      // declined rows never win over a row that is not declined; then the best tier wins
      const notDeclined = eligible.filter(live);
      const base = notDeclined.length ? notDeclined : eligible;
      const best = Math.min(...base.map(tier));
      const top = base.filter((r) => tier(r) === best);
      const keep = top.length === 1 || !notDeclined.length ? top[0]! : null;
      const conflict = keep ? [] : top;
      for (const r of conflict)
        flag(
          r,
          "DUPLICATE_CLAIM",
          "Several Luma registrations claim this deposit. Decline the wrong ones on Luma (or decide by hand which one is real).",
        );
      if (keep) {
        stage.push(keep);
        owners.push(keep);
      }
      for (const r of mine)
        if (r !== keep && !conflict.includes(r)) flag(r, "DUPLICATE_TX", copyNote(r, keep ?? conflict[0]));
    }
    for (const r of group) {
      if (MONEY_CODES.has(r.code)) continue; // handled above
      if (owners.length) flag(r, "DUPLICATE_TX", copyNote(r, owners[0]));
      else issues.push(r); // nobody owns it yet: the row keeps its own code (e.g. WRONG_SENDER)
    }
  }

  // 2. rows using the same wallet with different txs
  const kept: GuestCheck[] = [];
  const byWallet = new Map<string, GuestCheck[]>();
  for (const r of stage) {
    const k = r.wallet.toLowerCase();
    if (!byWallet.has(k)) byWallet.set(k, []);
    byWallet.get(k)!.push(r);
  }
  for (const group of byWallet.values()) {
    if (group.length === 1) {
      kept.push(group[0]!);
      continue;
    }
    const heldRows = group.filter(held);
    const heldVerified = heldRows.filter((r) => r.code === "VERIFIED");
    const { keep, conflict } = pick(heldVerified.length ? heldVerified : heldRows.length ? heldRows : group);
    for (const r of conflict)
      flag(
        r,
        "DUPLICATE_CLAIM",
        "Several Luma registrations use this wallet. Decline the wrong ones on Luma (or decide by hand which one is real).",
      );
    if (keep) kept.push(keep);
    for (const r of group) {
      if (r === keep || conflict.includes(r)) continue;
      if (keep)
        flag(
          r,
          "DUPLICATE_WALLET",
          `This wallet's deposit is already counted for ${who(keep)}. Any money from this extra deposit still held is listed in returns.csv.`,
          true,
        );
      else flag(r, "DUPLICATE_WALLET", "Other registrations use this wallet too. Decide by hand which one is real.");
    }
  }
  return { kept, issues };
}

export interface DepositIn {
  tx: string;
  from: string;
  amount: bigint;
  block: number;
  logIndex?: number;
}
export interface ReturnEvent {
  type: "Rejected" | "Refunded" | "StakerRegistered";
  wallet: string;
  amount: bigint;
  block: number;
  logIndex?: number;
  tx: string;
}
export interface DepositPairing {
  tx: string;
  from: string;
  amount: bigint;
  block: number;
  logIndex: number;
  /** wei of it the contract still holds */
  remaining: bigint;
  /** one deposit of it backs the wallet's registration */
  staked: boolean;
  returnedBy: string[];
}

/**
 * How much of each deposit the contract still holds for the wallet that sent it. Per wallet and in
 * chain order, every deposit is paired with what the contract sent back (Rejected, Refunded): a
 * return only covers deposits made before it, oldest first; a registered staker's staked deposit is
 * untouched by refund() and returned by a Rejected; a Rejected of an unregistered payer goes first to
 * a deposit in `prefer`; a Refunded goes first to a deposit whose unstaked part is exactly that
 * amount, then to deposits not in `prefer`. `stakers`: lower-case wallets registered at the snapshot.
 * `unbacked`: registrations with no deposit of their own; `unpaired`: returns larger than the deposits seen.
 */
export function pairReturns(
  deposits: readonly DepositIn[],
  events: readonly ReturnEvent[],
  {
    deposit,
    prefer = new Set(),
    stakers = new Set(),
    preferLatest = false,
  }: { deposit: bigint; prefer?: ReadonlySet<string>; stakers?: ReadonlySet<string>; preferLatest?: boolean },
): { byDeposit: Map<string, DepositPairing>; unbacked: ReturnEvent[]; unpaired: (ReturnEvent & { left: bigint })[] } {
  type Item = { block: number; logIndex: number; dep?: DepositPairing; ev?: ReturnEvent };
  const byDeposit = new Map<string, DepositPairing>();
  const timeline = new Map<string, Item[]>();
  const at = (w: string) => {
    const k = String(w).toLowerCase();
    if (!timeline.has(k)) timeline.set(k, []);
    return timeline.get(k)!;
  };
  for (const d of deposits) {
    const k = depKey(d.tx, d.from);
    if (byDeposit.has(k)) continue;
    const s: DepositPairing = {
      tx: String(d.tx).toLowerCase(),
      from: d.from,
      amount: d.amount,
      block: Number(d.block),
      logIndex: d.logIndex ?? -1,
      remaining: d.amount,
      staked: false,
      returnedBy: [],
    };
    byDeposit.set(k, s);
    at(d.from).push({ block: s.block, logIndex: s.logIndex, dep: s });
  }
  for (const e of events) at(e.wallet).push({ block: Number(e.block), logIndex: e.logIndex ?? 0, ev: e });

  const unbacked: ReturnEvent[] = [];
  const unpaired: (ReturnEvent & { left: bigint })[] = [];
  const preferred = (s: DepositPairing) => prefer.has(s.tx);
  for (const [wallet, list] of timeline) {
    list.sort((x, y) => x.block - y.block || x.logIndex - y.logIndex);
    const deps: DepositPairing[] = [];
    let staked: DepositPairing | null = null;
    const free = (s: DepositPairing) => s.remaining - (s === staked ? deposit : 0n);
    const stakeOne = () => {
      const ok = deps.filter((s) => s.remaining >= deposit);
      return ok.find(preferred) ?? (preferLatest ? ok.at(-1) : ok[0]) ?? null;
    };
    for (const it of list) {
      if (it.dep) {
        deps.push(it.dep);
        continue;
      }
      const e = it.ev!;
      if (e.type === "StakerRegistered") {
        staked = stakeOne();
        if (!staked) unbacked.push(e);
        continue;
      }
      let left = e.amount;
      if (e.type === "Rejected" && staked) {
        const t = staked.remaining < left ? staked.remaining : left;
        staked.remaining -= t;
        left -= t;
        staked.returnedBy.push(e.tx);
        staked = null;
      }
      const amount = left;
      const order =
        e.type === "Rejected"
          ? [...deps.filter(preferred), ...deps.filter((s) => !preferred(s))]
          : [...deps].sort(
              (x, y) =>
                (free(x) === amount ? 0 : 1) - (free(y) === amount ? 0 : 1) ||
                (preferred(x) ? 1 : 0) - (preferred(y) ? 1 : 0),
            );
      for (const s of order) {
        if (left === 0n) break;
        const f = free(s);
        if (f <= 0n) continue;
        const t = f < left ? f : left;
        s.remaining -= t;
        left -= t;
        s.returnedBy.push(e.tx);
      }
      if (left > 0n) unpaired.push({ ...e, left });
    }
    if (!staked && stakers.has(wallet)) staked = stakeOne();
    if (staked) staked.staked = true;
  }
  return { byDeposit, unbacked, unpaired };
}

export interface BlockRange {
  fromBlock: bigint;
  toBlock: bigint;
}
export interface LogsReader<L> {
  getLogs: (range: BlockRange) => Promise<readonly L[]>;
  getBlockNumber?: () => Promise<bigint>;
}
export interface ChunkOptions {
  retries?: number;
  delayMs?: number;
  minStep?: number;
}

/**
 * eth_getLogs over a block range in chunks of `step` blocks, so public RPCs that cap the range still
 * answer. A failing chunk is retried `retries` times with growing pauses, then split in halves down to
 * `minStep` blocks; only then does the scan stop, with a message saying what to change.
 */
export async function getLogsChunked<L>(
  reader: LogsReader<L>,
  fromBlock: number | bigint,
  toBlock: number | bigint | "latest" = "latest",
  step: number = DEFAULT_LOG_CHUNK,
  { retries = 3, delayMs = 1000, minStep = 100 }: ChunkOptions = {},
): Promise<L[]> {
  if (!Number.isInteger(step) || step < 1)
    throw new Error(`getLogsChunked: the chunk size must be a whole number of blocks, 1 or more (got ${step})`);
  if (toBlock === "latest" && !reader.getBlockNumber)
    throw new Error('getLogsChunked: toBlock "latest" needs getBlockNumber');
  const latest = toBlock === "latest" ? Number(await reader.getBlockNumber!()) : Number(toBlock);
  const out: L[] = [];
  const range = async (from: number, to: number): Promise<void> => {
    let err: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, delayMs * 2 ** (attempt - 1)));
      try {
        out.push(...(await reader.getLogs({ fromBlock: BigInt(from), toBlock: BigInt(to) })));
        return;
      } catch (e) {
        err = e;
      }
    }
    if (to - from + 1 > minStep) {
      const mid = from + Math.floor((to - from + 1) / 2);
      await range(from, mid - 1);
      return range(mid, to);
    }
    throw new Error(
      `Could not read the contract's history for blocks ${from}–${to} from the RPC after ${retries + 1} tries ` +
        `(${shortMessage(err)}). Try again in a few minutes, or set another "rpcUrl" (or a smaller "logChunk") in the config.`,
    );
  };
  for (let start = Number(fromBlock); start <= latest; start += step)
    await range(start, Math.min(start + step - 1, latest));
  return out;
}

export interface IncomingDeposit {
  tx: string;
  from: Address;
  amount: bigint;
  block: number;
  logIndex: number;
}

/** Every Deposited event of the contract within a block range, one entry per event. */
export async function incomingDeposits(
  client: Pick<PublicClient, "getLogs" | "getBlockNumber">,
  cfg: Pick<Config, "receiver"> & { logChunk?: number },
  fromBlock: number | bigint,
  toBlock: number | bigint | "latest" = "latest",
  step: number = cfg.logChunk ?? DEFAULT_LOG_CHUNK,
  opts?: ChunkOptions,
): Promise<IncomingDeposit[]> {
  const event = getAbiItem({ abi: kickbackAbi, name: "Deposited" });
  const reader: LogsReader<RawLog & { transactionHash: Hash | null; blockNumber: bigint | null }> = {
    getLogs: (range) => client.getLogs({ address: cfg.receiver, event, ...range }),
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
  };
  const logs = await getLogsChunked(reader, fromBlock, toBlock, step, opts);
  return logs.map((l) => ({
    tx: String(l.transactionHash).toLowerCase(),
    from: getAddress(sliceHex(l.topics[1]!, 12)),
    amount: hexToBigInt(l.data),
    block: Number(l.blockNumber),
    logIndex: l.logIndex ?? 0,
  }));
}
