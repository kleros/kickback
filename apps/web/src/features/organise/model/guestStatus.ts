import type { GuestRow } from "../operations/read";

const STATUS = ["No deposit", "Deposited", "Turned away", "Refunded"] as const;
const TONE = ["end", "ok", "warn", "end"] as const;

/**
 * A guest's status as the table shows it, with its dot's tone: one place, so the text and the colour agree.
 * `refundable`: the event is cancelled or its deadline was missed, so every deposit can be withdrawn.
 */
export function guestStatus(
  row: GuestRow,
  phase: number,
  refundable: boolean,
  /**
   * After the release: the contract's sharePaid for this wallet, the share, whether a pushed payment was refused,
   * and the Kleros cases still open (a lost case's held share raises every attendee's share later).
   */
  pay?: { sharePaid?: bigint; payoutShare: bigint; refused?: boolean; openCases?: number },
): { text: string; tone: "ok" | "warn" | "end" } {
  if (row.status !== 1) return { text: STATUS[row.status] ?? "Unknown", tone: TONE[row.status] ?? "end" };
  if (refundable) return { text: "Can withdraw deposit", tone: "warn" };
  if (phase === 0) return { text: row.attended ? "On the list" : "Deposited", tone: "ok" };
  if (row.attended && phase === 2 && pay) {
    const paid = pay.sharePaid ?? 0n;
    if (pay.refused) return { text: "Came · payment refused, claimable", tone: "warn" };
    if (paid >= pay.payoutShare)
      return { text: (pay.openCases ?? 0) > 0 ? "Came · paid so far" : "Came · paid", tone: "ok" };
    if (paid > 0n) return { text: "Came · partly paid", tone: "warn" };
    return { text: "Came · not paid yet", tone: "warn" };
  }
  if (row.attended) return { text: "Came", tone: "ok" };
  if (row.challenge?.state === 1) return { text: "Challenged", tone: "warn" };
  if (row.challenge?.state === 2) {
    const ch = row.challenge;
    if (ch.isRuled === true && (ch.ruling ?? 99) <= 2)
      return {
        text:
          ch.ruling === 1
            ? "Kleros ruled they came · not settled yet"
            : ch.ruling === 2
              ? "Kleros ruled they did not come · not settled yet"
              : "Kleros did not rule either way · not settled yet",
        tone: "warn",
      };
    return { text: "With Kleros", tone: "warn" };
  }
  // after the release a guest off the list has had their deposit shared among the attendees
  if (phase === 2) {
    const c = row.challenge;
    const why =
      c?.state === 3 ? (c.ruling === 0 ? " (Kleros did not rule either way)" : " (challenge lost at Kleros)") : "";
    return { text: `Did not come${why} · deposit shared`, tone: "end" };
  }
  return { text: "Not on the list", tone: "end" };
}
