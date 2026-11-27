import type { EventInfo } from "@kickback/core";

type Info = Pick<EventInfo, "phase" | "depositAmount" | "stakerCount" | "attendeeCount" | "openCases" | "payoutShare">;
type Challenge = { wallet: string; state: number };

/**
 * The share each attendee gets, as the contract's release will work it out: all deposits split over the
 * attendees on the list, the guests ticked but not saved yet, one share for each open Kleros case and one for
 * each challenge still waiting (it ends as one more share: added, sent to Kleros with a share held, or accepted
 * at the release). After the release, the contract's own figure. A ticked challenger is counted once: adding
 * them resolves their challenge.
 */
export function projectedShare(info: Info, challenges: readonly Challenge[], ticked: readonly string[] = []) {
  const pool = info.depositAmount * BigInt(info.stakerCount);
  const tickedSet = new Set(ticked.map((w) => w.toLowerCase()));
  const waiting = challenges.filter((c) => c.state === 1 && !tickedSet.has(c.wallet.toLowerCase())).length;
  const attendees = info.attendeeCount + tickedSet.size;
  const shares = attendees + info.openCases + waiting;
  const share = info.phase === 2 ? info.payoutShare : shares ? pool / BigInt(shares) : null;
  return { pool, shares, attendees, waiting, share };
}

const attendeesText = (n: number) => `${n} ${n === 1 ? "attendee" : "attendees"}`;
const isAre = (n: number) => (n === 1 ? "is" : "are");

/**
 * What is left to pay after the release, said for who is still unpaid: an attendee who claimed before a lost Kleros
 * case's held share was split is owed only the rest of their share. `refused` attendees' pushed payments were
 * refused by their wallet and wait for them on the guest page.
 */
export function unpaidLede(
  unpaid: readonly { owed: bigint; partlyPaid: boolean }[],
  total: number,
  share: bigint,
  fmt: (units: bigint) => string,
  refused = 0,
  /** Kleros cases still open: a lost case's held share is split among the attendees later. */
  openCases = 0,
) {
  const n = unpaid.length;
  const held =
    openCases === 1
      ? "a share is held for the open Kleros case and is split among the attendees unless Kleros rules that guest came"
      : `a share is held for each of the ${openCases} open Kleros cases, and each is split among the attendees unless Kleros rules that guest came`;
  if (n === 0)
    return refused > 0
      ? `Each attendee's share is ${fmt(share)}${openCases > 0 ? " so far" : ""}. Every share has been sent; ${refused === 1 ? "one could" : `${refused} could`} not be delivered and can be claimed on the guest page.${openCases > 0 ? ` Also, ${held}.` : ""}`
      : openCases > 0
        ? `Each attendee's share is ${fmt(share)} so far. Every attendee has been paid so far; ${held}.`
        : `Each attendee's share is ${fmt(share)}. Every attendee has been paid.`;
  const partly = unpaid.filter((u) => u.partlyPaid);
  const send = `They can claim it on the guest page, or you can send what each is owed now (you pay the network fee). The Guests tab shows each payment.`;
  if (partly.length > 0) {
    const amounts = new Set(unpaid.map((u) => u.owed.toString()));
    const head = `${n} of ${attendeesText(total)} still ${n === 1 ? "has" : "have"} money to claim`;
    if (amounts.size === 1)
      return `${head}, after the share held for a Kleros case was split. ${n === 1 ? "They are" : "Each is"} owed ${fmt(unpaid[0]!.owed)}. ${send}`;
    const k = partly.length;
    const full = n - k;
    const partOwed = new Set(partly.map((u) => u.owed.toString()));
    const partText =
      partOwed.size === 1
        ? `${k} ${isAre(k)} owed the rest of their share (${fmt(partly[0]!.owed)}${k === 1 ? "" : " each"}, after the share held for a Kleros case was split)`
        : `${k} ${isAre(k)} owed the rest of their share, after the share held for a Kleros case was split`;
    return `${head}: ${partText}${full > 0 ? ` and ${full} ${isAre(full)} owed the full ${fmt(share)}` : ""}. ${send}`;
  }
  if (n < total)
    return `${n} of ${attendeesText(total)} ${n === 1 ? "has" : "have"} not been paid yet. ${n === 1 ? "They can claim" : "Each can claim"} ${fmt(share)} on the guest page, or you can send ${n === 1 ? "it to them" : "them their shares"} now (you pay the network fee). The Guests tab shows each payment.`;
  return `Each attendee can claim ${fmt(share)} on the guest page. You can also send every attendee their share now (you pay the network fee).`;
}
