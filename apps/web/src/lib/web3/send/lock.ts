import type { Address, Hash } from "viem";
import { createStore } from "zustand/vanilla";

/** What one account's send under way is known to be: its contract once prepared, its hash once the wallet gives it. */
export type SendHold = { hash?: Hash; contract?: Address };

/**
 * One wallet action at a time per account (nonces are per account): while an account's send runs, its other sends
 * are refused. Other accounts in the same browser are not held up.
 */
export const sendLock = createStore<{ held: Map<string, SendHold> }>(() => ({ held: new Map() }));

const keyOf = (account: Address | string) => account.toLowerCase();

/** True while `account` has a send under way. */
export const isSendBusy = (account?: Address | string): boolean =>
  !!account && sendLock.getState().held.has(keyOf(account));

/** Takes the account's lock synchronously, so two calls in the same tick cannot both get it. False when it is held. */
export const acquireSendLock = (account: Address | string): boolean => {
  if (isSendBusy(account)) return false;
  const held = new Map(sendLock.getState().held);
  held.set(keyOf(account), {});
  sendLock.setState({ held });
  return true;
};

/** Notes what the account's send under way is (its contract, then its hash), for the "still confirming" notes. */
export const noteSendLock = (account: Address | string, hold: SendHold) => {
  const current = sendLock.getState().held.get(keyOf(account));
  if (!current) return;
  const held = new Map(sendLock.getState().held);
  held.set(keyOf(account), { ...current, ...hold });
  sendLock.setState({ held });
};

export const releaseSendLock = (account: Address | string) => {
  if (!isSendBusy(account)) return;
  const held = new Map(sendLock.getState().held);
  held.delete(keyOf(account));
  sendLock.setState({ held });
};

/** Clears every hold (tests). */
export const resetSendLock = () => sendLock.setState({ held: new Map() });
