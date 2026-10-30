export type KickbackErrorCode =
  | "NO_KICKBACK_CONTRACT"
  | "NOT_KICKBACK"
  | "UNKNOWN_CODE"
  | "DEPOSIT_MISMATCH"
  | "DEPLOY_BLOCK_NOT_FOUND"
  | "DEPLOY_BLOCK_TOO_LATE"
  | "INVALID_INPUT";

/** An error with a `code` callers branch on to word their own advice. */
export class KickbackError extends Error {
  readonly code: KickbackErrorCode;
  /** The contract's deposit (DEPOSIT_MISMATCH). */
  readonly depositAmount?: bigint;
  /** Field key → message, for every wrong form field (eventDetails). */
  readonly fields?: Record<string, string>;

  constructor(
    message: string,
    code: KickbackErrorCode,
    extra: { cause?: unknown; depositAmount?: bigint; fields?: Record<string, string> } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = "KickbackError";
    this.code = code;
    if (extra.depositAmount !== undefined) this.depositAmount = extra.depositAmount;
    if (extra.fields) this.fields = extra.fields;
  }
}

/** The short message of a viem error (shortMessage), or the message of any other. */
export const shortMessage = (e: unknown): string => {
  if (e && typeof e === "object") {
    const o = e as { shortMessage?: unknown; message?: unknown };
    if (typeof o.shortMessage === "string" && o.shortMessage) return o.shortMessage;
    if (typeof o.message === "string") return o.message;
  }
  return String(e);
};
