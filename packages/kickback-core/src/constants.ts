import { keccak256, toEventSelector, toHex, type Address } from "viem";

/** A deposit is the contract's own Deposited event (receive() or deposit()); `amount` is in wei. */
export const DEPOSITED_EVENT = "event Deposited(address indexed from, uint256 amount)";
export const DEPOSITED_TOPIC = toEventSelector("Deposited(address,uint256)");
/** An ERC-20 Transfer: tokens sent to the deposit contract are never a deposit. */
export const TOKEN_TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));

export const CHAINS = {
  ethereum: { chainId: 1, name: "Ethereum mainnet", explorer: "https://etherscan.io" },
} as const;
export const SYMBOL = "ETH";
export const DECIMALS = 18;
/** Public RPC that answers eth_getLogs on old block ranges in 5,000-block chunks. */
export const DEFAULT_RPC = "https://rpc.mevblocker.io";
export const DEFAULT_LOG_CHUNK = 5000;
/** A deposit above this per guest is almost surely a typo. */
export const MAX_DEPOSIT_ETH = "1";

// The next four must match the contract.
export const MIN_SETTLEMENT_WINDOW = 7 * 24 * 3600;
export const CHALLENGE_PERIOD = 24 * 3600;
export const MATCH_PERIOD = 24 * 3600;
/** Gas a batch payment may use in the recipient. */
export const PAYOUT_GAS = 40_000;
/** EIP-7825 (Fusaka): one transaction may use at most 2^24 gas, whatever the block limit. */
export const TX_GAS_CAP = 16_777_216n;
/** The gas limit to send with: `margin` percent over the estimate, never above TX_GAS_CAP. */
export const gasLimitFor = (estimate: bigint | number, margin = 30n): bigint => {
  const limit = (BigInt(estimate) * (100n + margin)) / 100n;
  return limit > TX_GAS_CAP ? TX_GAS_CAP : limit;
};

/**
 * Kleros Court v1 on Ethereum mainnet. Evidence, appeals and withdrawals go to the Dispute Resolver
 * (ArbitrableProxy) with the local dispute ID; passPeriod / executeRuling go to KlerosLiquid with the arbitrator dispute ID.
 */
export const KLEROS: Record<number, { disputeResolver: Address; arbitrator: Address; court: string }> = {
  1: {
    disputeResolver: "0x4b89e798b10478a839ea0abcf86c4b94a3c782a4",
    arbitrator: "0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069",
    court: "https://court.kleros.io",
  },
};
/** POST multipart/form-data, field "data", with ?operation=file|evidence&pinToGraph=false. */
export const KLEROS_IPFS_UPLOAD = "https://kleros-api.netlify.app/.netlify/functions/upload-to-ipfs";
export const KLEROS_IPFS_GATEWAY = "https://cdn.kleros.link";
/** Ruling 0 (refused to arbitrate) counts like "did not attend". */
export const RULINGS = { refused: 0, attended: 1, absent: 2 } as const;
/** KlerosLiquid disputes(id).period */
export const KLEROS_PERIODS = ["evidence", "commit", "vote", "appeal", "execution"] as const;

/** "/ipfs/<CIDv0 or CIDv1>" with an optional "/file" path, as Kleros expects for policies and (meta)evidence. */
export const IPFS_PATH_RE = /^\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(\/[^\s]+)?$/;
export const isIpfsPath = (v: unknown): boolean => IPFS_PATH_RE.test(String(v ?? ""));
/** Pins of earlier policy and metaevidence versions that must not be used any more. */
export const STALE_PINS = [
  "QmZMDkYNHVH5bZNPwNnav1ZoziRgL57zE6pTmwo5dqGGGg",
  "QmWzCbhNEaySZ8EtFgPKuq4AYCtJba962S4VT77AGdw25B",
  "QmXAtWkxqrYPhriV4s1r7cQktEfF3498M6tmhKjXtvFUgU",
];

// Contract enums
export const STATUS = { None: 0, Staker: 1, Paid: 2, Rejected: 3 } as const;
export const PHASES = ["Open", "Listed", "Finalized", "Cancelled"] as const;
export const CHALLENGE_STATE = { None: 0, Waiting: 1, Disputed: 2, Resolved: 3 } as const;

/** Values the contract writes into each case: the challenged wallet, itself, and the wallet in lower case. */
export const SLOT = { wallet: 1, contract: 2, walletLower: 3 } as const;
/** One 256 KiB IPFS block; contract metaevidence must fit in one. */
export const MAX_METAEVIDENCE_BYTES = 262_144;
/** The contract keeps abi.encode(pieces, slots) as contract code (24 KB limit). */
export const MAX_TEMPLATE_BYTES = 24_575;
/** Paths inside @kickback/contracts/docs. */
export const DEFAULT_METAEVIDENCE_TEMPLATE = "docs/metaevidence.template.json";
export const GENERIC_POLICY = "docs/attendance-policy.generic.md";
export const GENERIC_METAEVIDENCE_TEMPLATE = "docs/metaevidence.generic.template.json";

/** Result codes of a Luma row's check (verifyTx, verifyRegistrations, resolveClaims, checkGuests). */
export const ISSUE_CODES = [
  "VERIFIED",
  "NO_TX",
  "BAD_TX_HASH",
  "TX_PENDING",
  "WRONG_NETWORK",
  "TX_NOT_FOUND",
  "TX_FAILED",
  "NO_DEPOSIT_TRANSFER",
  "AMBIGUOUS_SENDER",
  "UNUSUAL_SENDER",
  "WRONG_SENDER",
  "OUTSIDE_WINDOW",
  "AMOUNT_TOO_LOW",
  "MULTIPLE_TX",
  "RPC_ERROR",
  "DUPLICATE_TX",
  "DUPLICATE_CLAIM",
  "DUPLICATE_WALLET",
  "PAID_AGAIN_DECLINED",
  "RETURNED_EARLIER",
  "REFUNDED_EARLIER",
  "DECLINED_AFTER_LIST",
  "REGISTERED_NOT_APPROVED",
  "OVERPAID",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];
/** Codes of returns.csv rows: what to give back with refund(). */
export type ReturnCode =
  "AMOUNT_TOO_LOW" | "OVERPAID" | "OUTSIDE_WINDOW" | "PAID_AGAIN_DECLINED" | "PARTLY_RETURNED" | "DUPLICATE_WALLET";

/** Rows whose own wallet really sent ETH to the contract in their tx (whether or not it counts as a deposit). */
export const MONEY_CODES: ReadonlySet<string> = new Set(["VERIFIED", "OUTSIDE_WINDOW", "AMOUNT_TOO_LOW"]);
/** A tx that could not be read this run (it may still turn out to be a deposit). */
export const UNREAD_CODES: ReadonlySet<string> = new Set(["RPC_ERROR", "TX_PENDING", "TX_NOT_FOUND"]);
