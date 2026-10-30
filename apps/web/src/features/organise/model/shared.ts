import type { Address } from "viem";

export interface Gate {
  enabled: boolean;
  lockedReason: string | null;
}

export function gate(reason?: string | null): Gate {
  return { enabled: !reason, lockedReason: reason || null };
}

export function requireEnabled(value: Gate): void {
  if (!value.enabled) throw new Error(value.lockedReason ?? "This action is unavailable.");
}

export interface EventScope {
  chainId: number;
  address: Address;
  deployBlock?: number;
}

export const organiserKey = (scope: EventScope) => ["organise", scope.chainId, scope.address.toLowerCase()] as const;

export function configKey(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) => (typeof item === "bigint" ? item.toString() : item));
}
