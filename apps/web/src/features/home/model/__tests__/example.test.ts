import { parseEther } from "viem";
import { describe, expect, it } from "vitest";

import { payoutExample } from "../example";

describe("payoutExample", () => {
  it("splits the pool of 10 × 0.01 ETH among 8 who came", () => {
    const example = payoutExample(parseEther("0.01"), 10, 8);
    expect(example.pool).toBe(parseEther("0.1"));
    expect(example.share).toBe(parseEther("0.0125"));
  });

  it("rounds down like the contract and pays nothing when nobody came", () => {
    expect(payoutExample(10n, 1, 3).share).toBe(3n);
    expect(payoutExample(10n, 4, 0).share).toBe(0n);
  });
});
