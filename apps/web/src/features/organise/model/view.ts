import { fmt } from "@kickback/core";
import { isAddress, type Address } from "viem";

import type { Phase } from "./phase";
import type { Gate } from "./shared";

/** An amount in wei as the organiser reads it: "0.011186 ETH". */
export const ethText = (units: bigint | null | undefined) =>
  units === null || units === undefined ? "—" : `${fmt(units)} ETH`;

export type Tone = "live" | "ok" | "warn" | "end";

export const PHASE_TONE: Record<Phase, Tone> = {
  "Deposits open": "live",
  "Waiting for the event": "live",
  "Attendance due": "warn",
  "List posted": "live",
  "Payouts ready": "ok",
  "Paid out": "end",
  Cancelled: "end",
  "Past the deadline": "warn",
};

/**
 * A gate whose only blocker left is something the dialog asks for (a typed word, an amount, a guest) opens
 * the dialog; any other reason keeps the control locked and is shown beside it.
 */
export function openable(value: Gate, ...askedInDialog: string[]): Gate {
  if (value.enabled) return value;
  const reason = (value.lockedReason ?? "").toLowerCase();
  return askedInDialog.some((needle) => reason.includes(needle.toLowerCase()))
    ? { enabled: true, lockedReason: null }
    : value;
}

/** Challenges are counted, never handled here (D8). */
export const challengeText = (open: number) => (open === 0 ? "None open" : `${open} open · handled in a later release`);

export function openAddress(input: string): { address: Address | null; error: string | null } {
  const text = input.trim();
  if (!text) return { address: null, error: "Paste the event's contract address." };
  if (!isAddress(text, { strict: false }))
    return { address: null, error: "That is not a contract address: 0x and 40 hex characters." };
  return { address: text as Address, error: null };
}

export const shortHex = (value: string, chars = 4) =>
  value.length > chars * 2 + 2 ? `${value.slice(0, chars + 2)}…${value.slice(-chars)}` : value;

/** Tone of a guest row's status line. */
export function statusTone(status: string): "ok" | "warn" | "err" | "end" {
  if (/^(Registered|Paid out|Deposit found)/.test(status)) return "ok";
  if (/nothing to send/i.test(status)) return "end";
  if (/(Less than|failed|another network|not found|outside)/i.test(status)) return "err";
  return "warn";
}

export const TYPED_WORDS = {
  post: "POST",
  noShow: "NOSHOW",
  pay: "PAY",
  sweep: "SWEEP",
  cancel: "CANCEL",
  another: "NEW",
} as const;

/** The case jurors read, as its question then its paragraphs; text that is not the case JSON is shown whole. */
export function caseView(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const { title, question, description } = parsed as Record<string, unknown>;
      const head = typeof question === "string" && question ? question : typeof title === "string" ? title : "";
      const body = typeof description === "string" ? description.split(/\n\s*\n/).filter(Boolean) : [];
      if (head || body.length) return [head, ...body];
    }
  } catch {
    // not JSON: shown as it is
  }
  return [text];
}
