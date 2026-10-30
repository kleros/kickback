import type { Address, PublicClient } from "viem";
import { vi } from "vitest";

export const address: Address = "0x1111111111111111111111111111111111111111";
export const guest: Address = "0x2222222222222222222222222222222222222222";

export function mockClient() {
  const values: Record<string, unknown> = {
    status: 1,
    owed: 0n,
    attended: false,
    payoutShare: 10n,
    depositAmount: 10n,
    phase: 0,
  };
  const methods = {
    getBlockNumber: vi.fn().mockResolvedValue(10n),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]),
  };
  return { values, methods, client: methods as unknown as PublicClient };
}
