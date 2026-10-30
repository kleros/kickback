import { QueryClient } from "@tanstack/react-query";

/**
 * Structural data is the client-wide default;
 * hooks for faster-moving data opt into a shorter tier explicitly.
 */
export const STALE_TIME = {
  /** RPC structure: addresses, settings, deploy blocks. */
  structural: 5 * 60_000,
  /** IPFS display payloads. */
  display: 5 * 60_000,
  /** Phase, status, open challenges. */
  live: 10_000,
  /** Balances. */
  balance: 5_000,
  /** Facts that cannot change once known, such as a mined block. */
  immutable: Infinity,
} as const;

export const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.structural,
        refetchOnWindowFocus: false,
        retry: 2,
      },
    },
  });
