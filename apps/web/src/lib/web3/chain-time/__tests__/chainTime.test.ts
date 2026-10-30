import { describe, expect, it, vi } from "vitest";

import { chainTimeOf, hasReached, readChainTime, secondsUntil } from "../chainTime";

const block = (number: bigint, timestamp: bigint) => ({ number, timestamp });

describe("chainTimeOf", () => {
  it("is the block's timestamp in seconds, whatever the laptop clock says", () => {
    vi.useFakeTimers({ now: new Date("2030-01-01T00:00:00Z") });
    try {
      expect(chainTimeOf(block(7n, 1_700_000_000n))).toEqual({ blockNumber: 7n, now: 1_700_000_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a pending block, whose time is not settled", () => {
    expect(() => chainTimeOf({ number: null, timestamp: 1n })).toThrow(/pending/);
  });
});

describe("hasReached", () => {
  const at = { blockNumber: 1n, now: 1_000 };

  it("matches the contract's block.timestamp >= deadline", () => {
    expect(hasReached(at, 999)).toBe(true);
    expect(hasReached(at, 1_000n)).toBe(true);
    expect(hasReached(at, 1_001)).toBe(false);
  });
});

describe("secondsUntil", () => {
  it("counts down on the chain's clock and stops at zero", () => {
    const at = { blockNumber: 1n, now: 1_000 };
    expect(secondsUntil(at, 1_060)).toBe(60);
    expect(secondsUntil(at, 900n)).toBe(0);
  });
});

describe("readChainTime", () => {
  it("reads the latest block when no number is given", async () => {
    const getBlock = vi.fn().mockResolvedValue(block(12n, 1_234n));
    await expect(readChainTime({ getBlock })).resolves.toEqual({ blockNumber: 12n, now: 1_234 });
    expect(getBlock).toHaveBeenCalledWith();
  });

  it("reads the block it is told to, so the time belongs to the block the hook watched", async () => {
    const getBlock = vi.fn().mockResolvedValue(block(5n, 500n));
    await expect(readChainTime({ getBlock }, 5n)).resolves.toEqual({ blockNumber: 5n, now: 500 });
    expect(getBlock).toHaveBeenCalledWith({ blockNumber: 5n });
  });
});
