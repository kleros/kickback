import {
  assertBatchable,
  depKey,
  type CheckGuestsResult,
  type IssueCode,
  type OverviewRow,
  type StampedList,
} from "@kickback/core";
import { getAddress, type Address } from "viem";

import { gate } from "./shared";

export const ISSUE_TEXT: Record<IssueCode | "PARTLY_RETURNED", string> = {
  VERIFIED: "Deposit found; register the approved guest.",
  NO_TX: "No transaction link on Luma; ask the guest for it.",
  BAD_TX_HASH: "The link is not a transaction; ask for the right link.",
  TX_PENDING: "Transaction still confirming; check again in a minute.",
  WRONG_NETWORK: "Sent on another network; ask the guest to deposit on Ethereum.",
  TX_NOT_FOUND: "Transaction not found on Ethereum; ask for the right link.",
  TX_FAILED: "Transaction failed; ask the guest to deposit again.",
  NO_DEPOSIT_TRANSFER: "Transaction did not pay this event; ask for the deposit transaction.",
  AMBIGUOUS_SENDER: "Cannot identify the sending wallet; ask the guest which wallet they used.",
  UNUSUAL_SENDER: "Sent by a smart wallet; confirm the wallet with the guest.",
  WRONG_SENDER: "Wallet differs from Luma; ask the guest to correct it on Luma.",
  OUTSIDE_WINDOW: "Sent outside the deposit window; return the money.",
  AMOUNT_TOO_LOW: "Less than the deposit; return it and ask for one full deposit.",
  MULTIPLE_TX: "Several deposits pasted; ask which to keep and return the others.",
  RPC_ERROR: "Could not check the deposit; check again.",
  DUPLICATE_TX: "Same transaction on two registrations; confirm who owns it on Luma.",
  DUPLICATE_CLAIM: "Same deposit claimed twice; confirm the real guest on Luma.",
  DUPLICATE_WALLET: "Same wallet on two registrations; keep one and decline the other on Luma.",
  PAID_AGAIN_DECLINED: "Paid again after being declined; return the new payment.",
  RETURNED_EARLIER: "Already returned; nothing to send.",
  REFUNDED_EARLIER: "Refunded earlier; nothing to send.",
  DECLINED_AFTER_LIST: "Declined after the list was posted; registration cannot be removed now.",
  REGISTERED_NOT_APPROVED: "Registered here but not approved on Luma; check with the guest.",
  OVERPAID: "More than the deposit; register once and return the extra.",
  PARTLY_RETURNED: "Part of this payment was returned; return only the remainder.",
};

export type Tick = "register" | "refund" | null;
export type Ticks = Readonly<Record<string, Tick>>;

export function guestRows(deposits: readonly OverviewRow[], check?: CheckGuestsResult | null, ticks: Ticks = {}) {
  const key = (r: { tx: string; wallet: string; email: string }) => `${depKey(r.tx, r.wallet)}:${r.email}`;
  const found = new Map(check ? [...check.verified, ...check.toReview, ...check.issues].map((r) => [key(r), r]) : []);
  const source = [...found.values()].map((r) => {
    const canRegister =
      check!.listOpen &&
      (check!.newStakers.some((item) => key(item) === key(r)) || check!.toReview.some((item) => key(item) === key(r)));
    const canRefund = check!.refunds.some((item) => key(item) === key(r));
    return {
      id: key(r),
      wallet: r.wallet,
      tx: r.tx,
      name: r.name,
      code: r.code,
      status: r.onchain,
      register: canRegister,
      refund:
        canRefund ||
        (r.code === "VERIFIED" &&
          r.onchain === "unregistered" &&
          check!.newStakers.some((item) => key(item) === key(r))) ||
        (check!.toReview.some((item) => key(item) === key(r)) && r.onchain === "unregistered") ||
        (r.onchain === "registered" &&
          check!.listOpen &&
          (r.code === "VERIFIED" || r.code === "REGISTERED_NOT_APPROVED")),
      auto:
        canRegister && check!.newStakers.some((item) => key(item) === key(r))
          ? ("register" as const)
          : canRefund
            ? ("refund" as const)
            : null,
    };
  });
  for (const r of deposits) {
    if (check && [...found.values()].some((item) => depKey(item.tx, item.wallet) === depKey(r.tx, r.from))) continue;
    source.push({
      id: depKey(r.tx, r.from),
      wallet: r.from,
      tx: r.tx,
      name: "",
      code: r.code as IssueCode,
      status: r.status,
      register: !check && r.canRegister,
      refund: !check && r.canRefund,
      auto: null,
    });
  }
  return source.map((r) => {
    const deposit = deposits.find((item) => depKey(item.tx, item.from) === depKey(r.tx, r.wallet));
    const chainStatus: Record<string, string> = {
      registered: "Registered",
      paid: "Paid out",
      refunded: "Refunded; nothing to send.",
      returned: "Already returned; nothing to send.",
      unknown: "Could not read wallet status; check again.",
    };
    const status =
      r.code === "VERIFIED" && r.status && chainStatus[r.status]
        ? chainStatus[r.status]!
        : r.status === "paid"
          ? "Paid out"
          : (ISSUE_TEXT[r.code as IssueCode] ?? "Could not verify this payment; check again.");
    const canRegister = gate(
      r.register
        ? null
        : r.status === "registered"
          ? "Already registered."
          : check && !check.listOpen
            ? "The attendance list is already posted."
            : status,
    );
    const canRefund = gate(
      r.refund ? null : "No verified refundable deposit; check the list or return only the stray amount.",
    );
    const tick = Object.hasOwn(ticks, r.id) ? ticks[r.id] : r.auto;
    return {
      id: r.id,
      name: r.name,
      wallet: r.wallet,
      tx: r.tx,
      amount: deposit?.amount ?? null,
      held: deposit?.held ?? null,
      sentAt: deposit?.sentAt ?? null,
      explorer: deposit?.explorer ?? null,
      status,
      canRegister,
      canRefund,
      tick: tick === "register" && canRegister.enabled ? tick : tick === "refund" && canRefund.enabled ? tick : null,
    };
  });
}

export function batches(wallets: readonly string[]): Address[][] {
  const checked = wallets.map((w) => getAddress(w));
  assertBatchable(checked);
  return Array.from({ length: Math.ceil(checked.length / 100) }, (_, i) => checked.slice(i * 100, (i + 1) * 100));
}

export function snapshotRefusal(
  snapshot: Pick<StampedList, "contract" | "chainId" | "deposit" | "block">,
  current: {
    contract: Address;
    chainId: number;
    deposit: bigint;
    block: number;
    relevantLogs: number;
    statusChanged: boolean;
  },
) {
  return gate(
    snapshot.contract.toLowerCase() !== current.contract.toLowerCase() || snapshot.chainId !== current.chainId
      ? "This list belongs to another event or network; check it again."
      : snapshot.deposit !== current.deposit.toString()
        ? "The deposit amount changed; check the list again."
        : !Number.isSafeInteger(snapshot.block) || snapshot.block < 0 || snapshot.block > current.block
          ? "The snapshot block is invalid; check the list again."
          : current.relevantLogs || current.statusChanged
            ? "Not sent. The contract changed since the check; check the list again. Your ticks are kept."
            : null,
  );
}

export function batchLists(list: StampedList): StampedList[] {
  batches(list.items.map((item) => item.wallet));
  return Array.from({ length: Math.ceil(list.items.length / 100) }, (_, index) => ({
    ...list,
    items: list.items.slice(index * 100, (index + 1) * 100),
  }));
}
