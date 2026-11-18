import type { Address } from "viem";

export const SYMBOL = "ETH";
export const DECIMALS = 18;
/** Public RPC that answers eth_getLogs on old block ranges in 5,000-block chunks. */
export const DEFAULT_RPC = "https://rpc.mevblocker.io";
export const DEFAULT_LOG_CHUNK = 5000;

/** EIP-7825 (Fusaka): one transaction may use at most 2^24 gas, whatever the block limit. */
export const TX_GAS_CAP = 16_777_216n;
/** The gas limit to send with: `margin` percent over the estimate, never above TX_GAS_CAP. */
export const gasLimitFor = (estimate: bigint | number, margin = 30n): bigint => {
  const limit = (BigInt(estimate) * (100n + margin)) / 100n;
  return limit > TX_GAS_CAP ? TX_GAS_CAP : limit;
};
/** Wallets per postAttendance / reject / distribute transaction, well inside the gas cap. */
export const BATCH_SIZE = 200;

/**
 * Kleros Court v1 on Ethereum mainnet. Evidence and appeals go to the Dispute Resolver (ArbitrableProxy)
 * with the local dispute ID; the court's own page uses the arbitrator dispute ID.
 */
export const KLEROS: Record<
  number,
  { disputeResolver: Address; arbitrator: Address; court: string; resolver: string }
> = {
  1: {
    disputeResolver: "0x4b89e798b10478a839ea0abcf86c4b94a3c782a4",
    arbitrator: "0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069",
    court: "https://court.kleros.io/cases/",
    resolver: "https://resolve.kleros.io/cases/",
  },
};
/** POST multipart/form-data, field "data", with ?operation=file|evidence&pinToGraph=false. */
export const KLEROS_IPFS_UPLOAD = "https://kleros-api.netlify.app/.netlify/functions/upload-to-ipfs";
export const KLEROS_IPFS_GATEWAY = "https://cdn.kleros.link";
/** Ruling 0 (refused to arbitrate) counts like "did not attend". */
export const RULINGS = { refused: 0, attended: 1, absent: 2 } as const;

/** "/ipfs/<CIDv0 or CIDv1>" with an optional "/file" path, as Kleros expects for policies and evidence. */
export const IPFS_PATH_RE = /^\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(\/[^\s]+)?$/;
export const isIpfsPath = (v: unknown): boolean => IPFS_PATH_RE.test(String(v ?? ""));

// PresenceEvent's enums
export const PHASE = { Open: 0, Listed: 1, Finalized: 2, Cancelled: 3 } as const;
export const STATUS = { None: 0, Staker: 1, Rejected: 2, Refunded: 3 } as const;
export const CHALLENGE_STATE = { None: 0, Waiting: 1, Disputed: 2, Resolved: 3 } as const;
