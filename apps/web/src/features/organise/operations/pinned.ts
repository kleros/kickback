import type { PublicClient } from "viem";

export function pinnedRead(
  client: Pick<PublicClient, "readContract">,
  blockNumber: bigint,
): PublicClient["readContract"] {
  // Only the block selector changes; the ABI-dependent return type is preserved.
  return ((args: Parameters<PublicClient["readContract"]>[0]) =>
    client.readContract({
      ...args,
      blockHash: undefined,
      blockTag: undefined,
      blockNumber,
    })) as PublicClient["readContract"];
}
