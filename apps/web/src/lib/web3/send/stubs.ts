// REPLACE with `gasLimitFor` / `TX_GAS_CAP` and the ABI-driven `errorText` from @kickback/core once it lands.

/** EIP-7825: one Ethereum transaction may use at most 2^24 gas, whatever the block limit. */
export const TX_GAS_CAP = 16_777_216n;

/** The gas limit to send with: `margin` percent over the estimate, never above TX_GAS_CAP. Port of core.mjs. */
export const gasLimitFor = (estimate: bigint, margin = 30n): bigint => {
  const limit = (estimate * (100n + margin)) / 100n;
  return limit > TX_GAS_CAP ? TX_GAS_CAP : limit;
};

/** Placeholder: viem's short message, with no decoding of the contract's custom errors. */
export const errorText = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const { shortMessage, message } = error as { shortMessage?: unknown; message?: unknown };
    if (typeof shortMessage === "string" && shortMessage) return shortMessage;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
};
